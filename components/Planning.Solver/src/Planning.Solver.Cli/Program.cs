using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using Google.OrTools.Sat;

var json = new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
    UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
    RespectRequiredConstructorParameters = true,
    WriteIndented = true
};
try
{
    if (args.Length != 0) throw new ArgumentException("Usage: Planning.Solver.Cli < request.json > result.json");
    Request request = JsonSerializer.Deserialize<Request>(Console.In.ReadToEnd(), json)
        ?? throw new ArgumentException("Missing solver request");
    Validate(request);
    var model = new CpModel();
    var variables = request.Candidates.ToDictionary(candidate => candidate.Id, candidate => model.NewBoolVar(candidate.Id), StringComparer.Ordinal);
    var optionVariables = new Dictionary<string, BoolVar>(StringComparer.Ordinal);
    var groupVariables = new Dictionary<string, BoolVar>(StringComparer.Ordinal);
    var byDemand = request.Candidates.GroupBy(candidate => candidate.DemandId)
        .ToDictionary(group => group.Key, group => group.Select(candidate => variables[candidate.Id]).ToArray(), StringComparer.Ordinal);
    foreach (Group group in request.Groups)
    {
        BoolVar chosen = model.NewBoolVar(group.Id);
        groupVariables.Add(group.Id, chosen);
        var choices = new List<BoolVar>();
        foreach (Option option in group.Options)
        {
            BoolVar enabled = model.NewBoolVar(option.Id);
            optionVariables.Add(option.Id, enabled);
            choices.Add(enabled);
            foreach (string demand in option.DemandIds)
                model.Add(LinearExpr.Sum(byDemand.GetValueOrDefault(demand, [])) == enabled);
        }
        model.Add(LinearExpr.Sum(choices) == chosen);
        if (group.Mandatory) model.Add(chosen == 1);
    }
    foreach (Conflict conflict in request.Conflicts)
        model.Add(variables[conflict.FirstCandidateId] + variables[conflict.SecondCandidateId] <= 1);
    long movementBound = request.Groups.Sum(group => (long)group.Options.Max(option => option.GeneratedMovements));
    long coverageFactor = checked(movementBound + 1);
    var terms = new List<LinearExpr>();
    foreach (Group group in request.Groups)
    {
        terms.Add(LinearExpr.Term(groupVariables[group.Id], checked(group.FlightCount * coverageFactor)));
        foreach (Option option in group.Options)
            terms.Add(LinearExpr.Term(optionVariables[option.Id], -option.GeneratedMovements));
    }
    model.Maximize(LinearExpr.Sum(terms));
    var solver = new CpSolver
    {
        StringParameters = $"num_search_workers:1 random_seed:0 max_time_in_seconds:{request.TimeLimitSeconds.ToString(CultureInfo.InvariantCulture)}"
    };
    CpSolverStatus status = solver.Solve(model);
    bool hasSolution = status is CpSolverStatus.Optimal or CpSolverStatus.Feasible;
    var assignments = hasSolution
        ? request.Candidates.Where(candidate => solver.BooleanValue(variables[candidate.Id])).ToArray()
        : [];
    var selected = hasSolution
        ? request.Groups.SelectMany(group => group.Options).Where(option => solver.BooleanValue(optionVariables[option.Id])).Select(option => option.Id).ToArray()
        : [];
    var unassigned = request.Groups.Where(group => !hasSolution || !solver.BooleanValue(groupVariables[group.Id])).Select(group => group.Id).ToArray();
    Console.WriteLine(JsonSerializer.Serialize(new
    {
        schema_version = "1.0.0",
        request_id = request.Id,
        engine = "google-or-tools-cp-sat",
        engine_version = typeof(CpSolver).Assembly.GetName().Version?.ToString(),
        status = status.ToString().ToLowerInvariant(),
        assignments,
        selected_option_ids = selected,
        unassigned_group_ids = unassigned,
        covered_flight_count = hasSolution ? request.Groups.Where(group => solver.BooleanValue(groupVariables[group.Id])).Sum(group => group.FlightCount) : 0,
        generated_movement_count = hasSolution ? request.Groups.SelectMany(group => group.Options).Where(option => solver.BooleanValue(optionVariables[option.Id])).Sum(option => option.GeneratedMovements) : 0
    }, json));
}
catch (Exception error) when (error is ArgumentException or JsonException or InvalidOperationException or OverflowException)
{
    Console.Error.WriteLine($"Local solver input/execution error: {error.Message}");
    Environment.ExitCode = 1;
}

static void Validate(Request request)
{
    if (request.SchemaVersion != "1.0.0" || string.IsNullOrWhiteSpace(request.Id))
        throw new ArgumentException("Unsupported or missing request identity/version");
    if (!double.IsFinite(request.TimeLimitSeconds) || request.TimeLimitSeconds <= 0 || request.TimeLimitSeconds > 300)
        throw new ArgumentException("Time limit must be in (0, 300] seconds");
    if (request.Groups is null || request.Candidates is null || request.Conflicts is null)
        throw new ArgumentException("Groups, candidates and conflicts are required");
    var ids = new HashSet<string>(StringComparer.Ordinal);
    var demandIds = new HashSet<string>(StringComparer.Ordinal);
    void Unique(string id)
    {
        if (string.IsNullOrWhiteSpace(id) || id.Any(char.IsWhiteSpace) || !ids.Add(id))
            throw new ArgumentException($"Invalid or duplicate solver ID: {id}");
    }
    foreach (Group group in request.Groups)
    {
        Unique(group.Id);
        if (group.FlightCount is < 0 or > 2 || group.Options is null || group.Options.Length == 0)
            throw new ArgumentException("Each group needs options and a flight count from zero to two");
        foreach (Option option in group.Options)
        {
            Unique(option.Id);
            if (option.GeneratedMovements is not (0 or 2) || option.DemandIds is null || option.DemandIds.Length == 0)
                throw new ArgumentException("Each option needs demands and zero or two generated movements");
            foreach (string demand in option.DemandIds)
                if (string.IsNullOrWhiteSpace(demand) || !demandIds.Add(demand))
                    throw new ArgumentException($"Duplicate or missing option demand: {demand}");
        }
    }
    var candidateIds = new HashSet<string>(StringComparer.Ordinal);
    var placements = new HashSet<(string, string)>();
    foreach (Candidate candidate in request.Candidates)
    {
        Unique(candidate.Id);
        candidateIds.Add(candidate.Id);
        if (!demandIds.Contains(candidate.DemandId) || string.IsNullOrWhiteSpace(candidate.StandId) ||
            !placements.Add((candidate.DemandId, candidate.StandId)))
            throw new ArgumentException("Candidate references an unknown demand, missing stand or duplicate placement");
    }
    foreach (Conflict conflict in request.Conflicts)
        if (conflict.FirstCandidateId == conflict.SecondCandidateId ||
            !candidateIds.Contains(conflict.FirstCandidateId) || !candidateIds.Contains(conflict.SecondCandidateId))
            throw new ArgumentException("Conflict must reference two different known candidates");
}

internal sealed record Request(string SchemaVersion, string Id, double TimeLimitSeconds, Group[] Groups, Candidate[] Candidates, Conflict[] Conflicts);
internal sealed record Group(string Id, int FlightCount, bool Mandatory, Option[] Options);
internal sealed record Option(string Id, string[] DemandIds, int GeneratedMovements);
internal sealed record Candidate(string Id, string DemandId, string StandId);
internal sealed record Conflict(string FirstCandidateId, string SecondCandidateId);
