using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;

namespace Planning.Solver.Orchestration;

/// <summary>Deterministic identity for idempotent optimization requests.</summary>
public static class OptimizationJobFingerprints
{
    /// <summary>Fingerprints every material request field except the idempotency key itself.</summary>
    public static string Request(OptimizationJobRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentException.ThrowIfNullOrWhiteSpace(request.JobId);
        ArgumentException.ThrowIfNullOrWhiteSpace(request.IdempotencyKey);
        ArgumentException.ThrowIfNullOrWhiteSpace(request.RunId);
        ArgumentException.ThrowIfNullOrWhiteSpace(request.CandidateBatchId);
        ArgumentNullException.ThrowIfNull(request.Problem);
        ArgumentNullException.ThrowIfNull(request.Rules);
        ArgumentNullException.ThrowIfNull(request.Profile);

        using IncrementalHash hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        Append(hash, request.JobId);
        Append(hash, request.RunId);
        Append(hash, request.CandidateBatchId);
        Append(hash, ArtifactFingerprints.Problem(request.Problem));
        Append(hash, ArtifactFingerprints.RulePackage(request.Rules));
        Append(hash, ArtifactFingerprints.Profile(request.Profile));
        Append(hash, (request.MetricInputs ?? MetricInputSet.Empty).Fingerprint);
        Append(hash, request.ParentPlanFingerprint ?? string.Empty);
        foreach ((string key, bool value) in (request.FeatureFlags
                     ?? new Dictionary<string, bool>(StringComparer.Ordinal))
                     .OrderBy(pair => pair.Key, StringComparer.Ordinal))
        {
            Append(hash, key);
            Append(hash, value ? "true" : "false");
        }

        return Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
    }

    private static void Append(IncrementalHash hash, string value)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(value);
        Span<byte> length = stackalloc byte[sizeof(int)];
        BinaryPrimitives.WriteInt32BigEndian(length, bytes.Length);
        hash.AppendData(length);
        hash.AppendData(bytes);
    }
}
