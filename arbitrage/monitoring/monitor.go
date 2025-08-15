package monitoring

import (
    "math/big"
    "net/http"
    "sync"
    "time"

    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promhttp"
)

type Monitor struct {
    mutex           sync.RWMutex
    opportunities   *prometheus.CounterVec
    executions      *prometheus.CounterVec
    profits         *prometheus.HistogramVec
    spreads         *prometheus.GaugeVec
    executionTime   *prometheus.HistogramVec
    
    totalProfit     *big.Int
    totalExecutions uint64
    startTime       time.Time
}

func NewMonitor() *Monitor {
    opportunities := prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "arbitrage_opportunities_total",
            Help: "Total number of arbitrage opportunities detected",
        },
        []string{"asset"},
    )
    
    executions := prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "arbitrage_executions_total",
            Help: "Total number of arbitrage executions",
        },
        []string{"asset", "success"},
    )
    
    profits := prometheus.NewHistogramVec(
        prometheus.HistogramOpts{
            Name:    "arbitrage_profit_usd",
            Help:    "Profit distribution in USD",
            Buckets: prometheus.ExponentialBuckets(1, 2, 10),
        },
        []string{"asset"},
    )
    
    spreads := prometheus.NewGaugeVec(
        prometheus.GaugeOpts{
            Name: "arbitrage_spread_basis_points",
            Help: "Current spread in basis points",
        },
        []string{"asset"},
    )
    
    executionTime := prometheus.NewHistogramVec(
        prometheus.HistogramOpts{
            Name:    "arbitrage_execution_time_ms",
            Help:    "Execution time in milliseconds",
            Buckets: prometheus.ExponentialBuckets(10, 2, 10),
        },
        []string{"asset"},
    )
    
    prometheus.MustRegister(opportunities, executions, profits, spreads, executionTime)
    
    return &Monitor{
        opportunities:   opportunities,
        executions:      executions,
        profits:         profits,
        spreads:         spreads,
        executionTime:   executionTime,
        totalProfit:     big.NewInt(0),
        totalExecutions: 0,
        startTime:       time.Now(),
    }
}

func (m *Monitor) Start(addr string) {
    http.Handle("/metrics", promhttp.Handler())
    http.HandleFunc("/stats", m.statsHandler)
    http.ListenAndServe(addr, nil)
}

func (m *Monitor) RecordOpportunity(asset uint32, spread *big.Int) {
    m.opportunities.WithLabelValues(string(rune(asset))).Inc()
    
    spreadBps := new(big.Int).Mul(spread, big.NewInt(10000))
    spreadBps.Div(spreadBps, big.NewInt(100000000))
    
    m.spreads.WithLabelValues(string(rune(asset))).Set(float64(spreadBps.Int64()))
}

func (m *Monitor) RecordExecution(asset uint32, profit *big.Int, success bool) {
    m.mutex.Lock()
    defer m.mutex.Unlock()
    
    successStr := "false"
    if success {
        successStr = "true"
        m.totalProfit.Add(m.totalProfit, profit)
        m.totalExecutions++
    }
    
    m.executions.WithLabelValues(string(rune(asset)), successStr).Inc()
    
    if success && profit.Sign() > 0 {
        profitUSD := new(big.Int).Div(profit, big.NewInt(100000000))
        m.profits.WithLabelValues(string(rune(asset))).Observe(float64(profitUSD.Int64()))
    }
}

func (m *Monitor) statsHandler(w http.ResponseWriter, r *http.Request) {
    m.mutex.RLock()
    defer m.mutex.RUnlock()
    
    uptime := time.Since(m.startTime)
    avgProfit := new(big.Int)
    if m.totalExecutions > 0 {
        avgProfit.Div(m.totalProfit, big.NewInt(int64(m.totalExecutions)))
    }
    
    w.Header().Set("Content-Type", "application/json")
    w.Write([]byte(`{
        "uptime_seconds": ` + string(rune(int(uptime.Seconds()))) + `,
        "total_executions": ` + string(rune(m.totalExecutions)) + `,
        "total_profit": "` + m.totalProfit.String() + `",
        "average_profit": "` + avgProfit.String() + `"
    }`))
}