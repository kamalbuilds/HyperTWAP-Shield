package detector

import (
    "context"
    "math/big"
    "time"

    "github.com/ethereum/go-ethereum/common"
    "github.com/ethereum/go-ethereum/ethclient"
    "github.com/sirupsen/logrus"
)

type Opportunity struct {
    Asset       uint32
    CorePrice   *big.Int
    EVMPrice    *big.Int
    Spread      *big.Int
    IsBuy       bool
    Amount      *big.Int
    Timestamp   time.Time
}

type Detector struct {
    logger     *logrus.Logger
    coreClient *ethclient.Client
    evmClient  *ethclient.Client
    monitor    Monitor
    
    perpOracleAddr common.Address
    spotOracleAddr common.Address
}

type Monitor interface {
    RecordOpportunity(asset uint32, spread *big.Int)
}

func NewDetector(logger *logrus.Logger, monitor Monitor) (*Detector, error) {
    coreClient, err := ethclient.Dial("https://rpc.hyperliquid.xyz/evm")
    if err != nil {
        return nil, err
    }
    
    evmClient, err := ethclient.Dial("https://rpc.hyperliquid.xyz/evm")
    if err != nil {
        return nil, err
    }
    
    return &Detector{
        logger:         logger,
        coreClient:     coreClient,
        evmClient:      evmClient,
        monitor:        monitor,
        perpOracleAddr: common.HexToAddress("0x0000000000000000000000000000000000000807"),
        spotOracleAddr: common.HexToAddress("0x0000000000000000000000000000000000000808"),
    }, nil
}

func (d *Detector) Start(ctx context.Context, opportunities chan<- *Opportunity) {
    ticker := time.NewTicker(100 * time.Millisecond)
    defer ticker.Stop()
    
    assets := []uint32{0, 1, 2, 3, 4}
    
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            for _, asset := range assets {
                opp := d.detectOpportunity(asset)
                if opp != nil {
                    select {
                    case opportunities <- opp:
                        d.logger.WithFields(logrus.Fields{
                            "asset":  opp.Asset,
                            "spread": opp.Spread,
                        }).Info("Opportunity detected")
                    default:
                        d.logger.Warn("Opportunities channel full")
                    }
                }
            }
        }
    }
}

func (d *Detector) detectOpportunity(asset uint32) *Opportunity {
    perpPrice := d.getPerpPrice(asset)
    spotPrice := d.getSpotPrice(asset)
    
    if perpPrice == nil || spotPrice == nil {
        return nil
    }
    
    spread := new(big.Int).Sub(perpPrice, spotPrice)
    if spread.Sign() < 0 {
        spread.Neg(spread)
    }
    
    minSpread := big.NewInt(10000000)
    if spread.Cmp(minSpread) < 0 {
        return nil
    }
    
    d.monitor.RecordOpportunity(asset, spread)
    
    return &Opportunity{
        Asset:     asset,
        CorePrice: perpPrice,
        EVMPrice:  spotPrice,
        Spread:    spread,
        IsBuy:     perpPrice.Cmp(spotPrice) > 0,
        Amount:    big.NewInt(100000000),
        Timestamp: time.Now(),
    }
}

func (d *Detector) getPerpPrice(asset uint32) *big.Int {
    return big.NewInt(5000_00000000)
}

func (d *Detector) getSpotPrice(asset uint32) *big.Int {
    return big.NewInt(4999_00000000)
}