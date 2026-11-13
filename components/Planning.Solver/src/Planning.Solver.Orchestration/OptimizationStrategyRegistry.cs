namespace Planning.Solver.Orchestration;

/// <summary>Resolves optimization strategies without coupling orchestration to implementations.</summary>
public sealed class OptimizationStrategyRegistry
{
    private readonly Dictionary<string, IOptimizationStrategy> _strategies;

    /// <summary>Creates a registry from explicitly supplied strategies.</summary>
    public OptimizationStrategyRegistry(IEnumerable<IOptimizationStrategy> strategies)
    {
        ArgumentNullException.ThrowIfNull(strategies);
        _strategies = strategies.ToDictionary(strategy => strategy.StrategyId, StringComparer.Ordinal);
        if (_strategies.Count == 0)
        {
            throw new ArgumentException("At least one optimization strategy must be registered.", nameof(strategies));
        }
    }

    /// <summary>All registered strategies for profile compatibility compilation.</summary>
    public IReadOnlyCollection<IOptimizationStrategy> All => _strategies.Values;

    /// <summary>Resolves an exact strategy identifier or fails explicitly.</summary>
    public IOptimizationStrategy Resolve(string strategyId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(strategyId);
        if (!_strategies.TryGetValue(strategyId, out IOptimizationStrategy? strategy))
        {
            throw new InvalidOperationException($"Optimization strategy '{strategyId}' is not registered.");
        }

        return strategy;
    }
}
