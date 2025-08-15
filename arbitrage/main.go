package main

import (
    "context"
    "os"
    "os/signal"
    "syscall"
    "time"

    "github.com/hypercore-suite/arbitrage/detector"
    "github.com/hypercore-suite/arbitrage/executor"
    "github.com/hypercore-suite/arbitrage/monitoring"
    "github.com/joho/godotenv"
    "github.com/sirupsen/logrus"
)

func main() {
    if err := godotenv.Load(); err != nil {
        logrus.Warn("No .env file found")
    }

    logger := setupLogger()
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    monitor := monitoring.NewMonitor()
    go monitor.Start(":8080")

    det, err := detector.NewDetector(logger, monitor)
    if err != nil {
        logger.Fatal("Failed to create detector:", err)
    }

    exec, err := executor.NewExecutor(logger, monitor)
    if err != nil {
        logger.Fatal("Failed to create executor:", err)
    }

    opportunities := make(chan *detector.Opportunity, 100)

    go det.Start(ctx, opportunities)
    go exec.Start(ctx, opportunities)

    sigChan := make(chan os.Signal, 1)
    signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
    <-sigChan

    logger.Info("Shutting down...")
    cancel()
    time.Sleep(2 * time.Second)
}

func setupLogger() *logrus.Logger {
    logger := logrus.New()
    logger.SetFormatter(&logrus.JSONFormatter{})
    
    level, err := logrus.ParseLevel(os.Getenv("LOG_LEVEL"))
    if err != nil {
        level = logrus.InfoLevel
    }
    logger.SetLevel(level)
    
    return logger
}