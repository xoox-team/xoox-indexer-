import {expect,it} from "vitest";
import {createTestIndexer} from "envio";
import type {Address} from "viem";
import "./handlers/index";
const token="0x1000000000000000000000000000000000000000",curve="0x2000000000000000000000000000000000000000",creator="0x3000000000000000000000000000000000000000",factory="0x4000000000000000000000000000000000000000",feeVault="0x5000000000000000000000000000000000000000",zero="0x0000000000000000000000000000000000000000";
const hook="0x6000000000000000000000000000000000000000",router="0x7000000000000000000000000000000000000000",manager="0x8000000000000000000000000000000000000000",treasury="0x9000000000000000000000000000000000000000",dividends="0xa000000000000000000000000000000000000000",externalRouter="0xb000000000000000000000000000000000000000";
const poolId=`0x${"ab".repeat(32)}`;

it.each([false,true])("revalues current market cap immediately after a real burn (pool=%s)",async(pool)=>{
  const test=createTestIndexer();
  await seedLaunch(test);
  await test.process({chains:{143:{simulate:[
    {contract:"Token",event:"Transfer",srcAddress:token,block:{number:2},transaction:{hash:`0x${"21".repeat(32)}`},params:{from:zero,to:curve,value:1000n}},
    {contract:"Token",event:"TokenMetadata",srcAddress:token,block:{number:2},params:{name:"Burn",symbol:"BRN",image:"",description:"",website:"",twitter:"",telegram:"",supply:1000n}}
  ]}}});
  if(pool) await test.process({chains:{143:{simulate:[
    {contract:"Hook",event:"PoolRegistered",srcAddress:hook,block:{number:3},params:{poolId,token}},
    {contract:"PoolManager",event:"Initialize",srcAddress:manager,block:{number:3},params:{id:poolId,currency0:zero,currency1:token,fee:0n,tickSpacing:200n,hooks:hook,sqrtPriceX96:1n<<96n,tick:0n}},
    {contract:"PoolManager",event:"Swap",srcAddress:manager,block:{number:3},params:{id:poolId,sender:router,amount0:-100n,amount1:100n,sqrtPriceX96:1n<<96n,liquidity:1000n,tick:0n,fee:0n}}
  ]}}});
  const before=await test.Launch.getOrThrow(token);
  await test.process({chains:{143:{simulate:[
    {contract:"Token",event:"Transfer",srcAddress:token,block:{number:4},transaction:{hash:`0x${"41".repeat(32)}`},params:{from:curve,to:feeVault,value:100n}},
    {contract:"Token",event:"Transfer",srcAddress:token,block:{number:5},transaction:{hash:`0x${"51".repeat(32)}`},params:{from:feeVault,to:zero,value:100n}}
  ]}}});
  const after=await test.Launch.getOrThrow(token);
  expect(after.supply).toBe(900n);
  expect(after.priceQuoteX18).toBe(before.priceQuoteX18);
  expect(after.marketCapQuote).toBe(before.marketCapQuote!*9n/10n);
});

async function seedLaunch(test:ReturnType<typeof createTestIndexer>,dividendVault:Address=zero) {
  await test.process({chains:{143:{simulate:[
    {contract:"FeeVault",event:"BuybackExecutorConfigured",srcAddress:feeVault,block:{number:1},params:{executor:router}},
    {contract:"Factory",event:"TokenLaunched",srcAddress:factory,block:{number:1},transaction:{hash:`0x${"11".repeat(32)}`},params:{token,curve,creator,quoteAsset:zero,configId:0n}},
    {contract:"Factory",event:"LaunchEconomicsSnapshotted",srcAddress:factory,block:{number:1},params:{token,supply:1000n,phantomQuote:100n,graduationThreshold:250n,baseBps:100n,creatorTaxBps:0n,protocolShareBps:3000n,buybackShareBps:5000n,buybackEnabled:false,dividendVault,dividendShareBps:dividendVault===zero?0n:2000n}},
    ...(dividendVault===zero?[]:[{contract:"Token" as const,event:"DividendVaultSet" as const,srcAddress:token as Address,block:{number:1},params:{vault:dividendVault}}])
  ]}}});
}

it("preserves explicit strategy shares and distinguishes budgets from completed burn/LP work",async()=>{
  const test=createTestIndexer();await seedLaunch(test);
  await test.process({chains:{143:{simulate:[
    {contract:"Factory",event:"FeeStrategySnapshotted",srcAddress:factory,block:{number:2},params:{token,baseFeeEnabled:false,creatorBps:0n,holderBps:7000n,burnBps:2000n,liquidityBps:1000n}},
    {contract:"FeeVault",event:"FeeStrategyAllocated",srcAddress:feeVault,block:{number:3},params:{token,asset:zero,protocolAmount:30n,creatorAmount:0n,holderAmount:70n,burnAmount:20n,liquidityAmount:10n}},
    {contract:"FeeVault",event:"BurnProcessed",srcAddress:feeVault,block:{number:4},params:{token,quoteSpent:12n,tokensBurned:120n,quoteRemaining:8n}},
    {contract:"FeeVault",event:"LiquidityProcessed",srcAddress:feeVault,block:{number:5},params:{token,positionId:123n,quoteSpent:7n,tokensBought:40n,tokensUsed:32n,liquidityAdded:90n,quoteRemaining:3n,tokensRemaining:8n}}
  ]}}});
  expect(await test.Launch.getOrThrow(token)).toMatchObject({feeStrategyEnabled:true,baseFeeEnabled:false,strategyCreatorBps:0n,strategyHolderBps:7000n,strategyBurnBps:2000n,strategyLiquidityBps:1000n});
  expect(await test.StrategyBalance.getOrThrow(token)).toMatchObject({pendingBurn:8n,pendingLiquidity:3n,pendingLiquidityTokens:8n,tokensBurned:120n,liquidityAdded:90n});
  expect(await test.StrategyAllocation.getAll()).toHaveLength(1);
  expect(await test.StrategyExecution.getAll()).toHaveLength(2);
});

it("counts all public V4 routers once while retaining separate settled user trade rows",async()=>{
  const test=createTestIndexer();await seedLaunch(test);
  await test.process({chains:{143:{simulate:[
    {contract:"Hook",event:"PoolRegistered",srcAddress:hook,block:{number:2},params:{poolId,token}},
    {contract:"PoolManager",event:"Initialize",srcAddress:manager,block:{number:2},params:{id:poolId,currency0:zero,currency1:token,fee:0n,tickSpacing:200n,hooks:hook,sqrtPriceX96:1n<<96n,tick:0n}},
    {contract:"PoolManager",event:"Swap",srcAddress:manager,block:{number:3},params:{id:poolId,sender:router,amount0:-12n,amount1:10n,sqrtPriceX96:1n<<96n,liquidity:1000n,tick:0n,fee:0n}},
    {contract:"SwapRouter",event:"PoolTrade",srcAddress:router,block:{number:3},params:{token,trader:creator,recipient:creator,buy:true,amountIn:12n,amountOut:9n}},
    {contract:"PoolManager",event:"Swap",srcAddress:manager,block:{number:4},params:{id:poolId,sender:externalRouter,amount0:7n,amount1:-8n,sqrtPriceX96:1n<<96n,liquidity:1000n,tick:0n,fee:0n}},
    {contract:"PoolManager",event:"Swap",srcAddress:manager,block:{number:5},params:{id:poolId,sender:router,amount0:2n,amount1:-3n,sqrtPriceX96:2n<<96n,liquidity:1000n,tick:0n,fee:0n}}
  ]}}});
  const launch=await test.Launch.getOrThrow(token);
  expect(launch.tradeCount).toBe(2n);expect(launch.quoteVolume).toBe(19n);
  expect(await test.PoolSwap.getAll()).toHaveLength(3);
  const trades=await test.Trade.getAll();expect(trades).toHaveLength(1);
  expect(trades[0].tokens).toBe(9n);
  expect(trades[0].baseFee).toBeUndefined();expect(trades[0].creatorTax).toBeUndefined();
  expect((await test.Pool.getOrThrow(poolId)).sqrtPriceX96).toBe(2n<<96n);
  expect(launch.priceQuoteX18).toBe(10n**36n/4n);
  expect(launch.marketCapQuote).toBe(250n);
});

it("updates curve reserves for internal burns without adding public trades or settlement links",async()=>{
  const test=createTestIndexer();await seedLaunch(test);
  const publicTx=`0x${"bc".repeat(32)}` as `0x${string}`,burnTx=`0x${"bd".repeat(32)}` as `0x${string}`;
  // A launch-and-buy or payment router is distinct from the registered internal executor.
  await test.process({chains:{143:{simulate:[
    {contract:"Curve",event:"CurveBuy",srcAddress:curve,block:{number:2,timestamp:20},transaction:{hash:publicTx},logIndex:1,params:{buyer:externalRouter,recipient:creator,tokensOut:100n,quoteSpent:12n,quoteRefund:0n,baseFee:1n,creatorTax:0n,snipeTax:0n,realQuoteReserve:11n,tokenReserve:900n}}
  ]}}});
  const before=await test.Launch.getOrThrow(token);
  await test.process({chains:{143:{simulate:[
    {contract:"FeeVault",event:"FeeStrategyAllocated",srcAddress:feeVault,block:{number:3},params:{token,asset:zero,protocolAmount:0n,creatorAmount:0n,holderAmount:0n,burnAmount:8n,liquidityAmount:0n}},
    {contract:"Curve",event:"CurveBuy",srcAddress:curve,block:{number:4,timestamp:40},transaction:{hash:burnTx},logIndex:1,params:{buyer:router,recipient:feeVault,tokensOut:100n,quoteSpent:8n,quoteRefund:0n,baseFee:0n,creatorTax:0n,snipeTax:0n,realQuoteReserve:19n,tokenReserve:800n}},
    {contract:"FeeVault",event:"BurnProcessed",srcAddress:feeVault,block:{number:4,timestamp:40},transaction:{hash:burnTx},logIndex:2,params:{token,quoteSpent:8n,tokensBurned:100n,quoteRemaining:0n}}
  ]}}});
  const after=await test.Launch.getOrThrow(token);
  expect(after).toMatchObject({quoteVolume:12n,tradeCount:1n,lastTradeAt:before.lastTradeAt,realQuoteReserve:19n,tokenReserve:800n,priceQuoteX18:119n*10n**36n/800n,marketCapQuote:148n,progressBps:760n});
  const trades=await test.Trade.getAll();expect(trades).toHaveLength(1);
  expect(trades[0]).toMatchObject({trader:externalRouter,recipient:creator,transactionHash:publicTx});
  expect(await test.LatestSettlement.getAll()).toHaveLength(1);
  expect(await test.LatestSettlement.get(`143:${burnTx}:${token}`)).toBeUndefined();
  expect(await test.StrategyExecution.getAll()).toHaveLength(1);
  expect(await test.StrategyBalance.getOrThrow(token)).toMatchObject({pendingBurn:0n,tokensBurned:100n});
});

it("updates active liquidity from position changes before the first swap",async()=>{
  const test=createTestIndexer();await seedLaunch(test);
  await test.process({chains:{143:{simulate:[
    {contract:"Hook",event:"PoolRegistered",srcAddress:hook,block:{number:2},params:{poolId,token}},
    {contract:"PoolManager",event:"Initialize",srcAddress:manager,block:{number:2},params:{id:poolId,currency0:zero,currency1:token,fee:0n,tickSpacing:200n,hooks:hook,sqrtPriceX96:1n<<96n,tick:0n}},
    {contract:"PoolManager",event:"ModifyLiquidity",srcAddress:manager,block:{number:3},params:{id:poolId,sender:router,tickLower:-200n,tickUpper:200n,liquidityDelta:1000n,salt:poolId}},
    {contract:"PoolManager",event:"ModifyLiquidity",srcAddress:manager,block:{number:4},params:{id:poolId,sender:router,tickLower:200n,tickUpper:400n,liquidityDelta:300n,salt:poolId}},
    {contract:"PoolManager",event:"ModifyLiquidity",srcAddress:manager,block:{number:5},params:{id:poolId,sender:router,tickLower:-200n,tickUpper:200n,liquidityDelta:-100n,salt:poolId}}
  ]}}});
  expect((await test.Pool.getOrThrow(poolId)).liquidity).toBe(900n);
  expect(await test.LiquidityChange.getAll()).toHaveLength(3);
});

it("conserves dividend deposits across claims and empty-epoch rollovers",async()=>{
  const test=createTestIndexer();await seedLaunch(test,dividends);
  await test.process({chains:{143:{simulate:[
    {contract:"DividendVault",event:"RewardsDeposited",srcAddress:dividends,block:{number:2},params:{epoch:0n,amount:100n}},
    {contract:"DividendVault",event:"EmptyEpochRolledOver",srcAddress:dividends,block:{number:3},params:{sourceEpoch:0n,targetEpoch:1n,amount:100n}},
    {contract:"DividendVault",event:"RewardsDeposited",srcAddress:dividends,block:{number:4},params:{epoch:1n,amount:20n}},
    {contract:"DividendVault",event:"DividendClaimed",srcAddress:dividends,block:{number:5},params:{epoch:1n,beneficiary:creator,amount:90n}}
  ]}}});
  expect((await test.DividendEpoch.getOrThrow(`${dividends}:0`)).remaining).toBe(0n);
  const epoch=await test.DividendEpoch.getOrThrow(`${dividends}:1`);
  expect(epoch.deposited).toBe(120n);expect(epoch.claimed).toBe(90n);expect(epoch.remaining).toBe(30n);
});

it("preserves the treasury buyback reserve when operations income is claimed",async()=>{
  const test=createTestIndexer();
  await test.process({chains:{143:{simulate:[
    {contract:"Treasury",event:"IncomeAllocated",srcAddress:treasury,block:{number:1},params:{asset:zero,received:100n,buybackAmount:80n,opsAmount:20n}},
    {contract:"Treasury",event:"OpsClaimed",srcAddress:treasury,block:{number:2},params:{asset:zero,recipient:creator,amount:20n}}
  ]}}});
  const asset=await test.TreasuryAsset.getOrThrow(zero);
  expect(asset.reservedBuyback).toBe(80n);expect(asset.opsAccrued-asset.opsClaimed).toBe(0n);
});

it("reduces the treasury reserve by actual protocol-buyback input only",async()=>{
  const test=createTestIndexer();
  await test.process({chains:{143:{simulate:[
    {contract:"Treasury",event:"IncomeAllocated",srcAddress:treasury,block:{number:1},params:{asset:zero,received:100n,buybackAmount:80n,opsAmount:20n}},
    {contract:"Treasury",event:"ProtocolBuybackProcessed",srcAddress:treasury,block:{number:2},params:{quoteAsset:zero,quoteSpent:30n,tokensLocked:1000n,unspent:10n}}
  ]}}});
  const asset=await test.TreasuryAsset.getOrThrow(zero);
  expect(asset.reservedBuyback).toBe(50n);expect(asset.opsAccrued).toBe(20n);expect(asset.received).toBe(100n);
});
it("reconstructs metadata, launch, buy, holdings and fee claims from events",async()=>{
  const test=createTestIndexer();
  await test.process({chains:{143:{simulate:[
    {contract:"Token",event:"Transfer",srcAddress:token,block:{number:1},params:{from:zero,to:curve,value:1_000n}},
    {contract:"Token",event:"TokenMetadata",srcAddress:token,block:{number:1},params:{name:"Original",symbol:"ORG",image:"",description:"",website:"",twitter:"",telegram:"",supply:1_000n}},
    {contract:"Factory",event:"TokenLaunched",srcAddress:factory,block:{number:1},params:{token,curve,creator,quoteAsset:zero,configId:0n}},
    {contract:"Factory",event:"CreatorFeeRecipientUpdated",srcAddress:factory,block:{number:1},params:{token,previousRecipient:zero,recipient:externalRouter}},
    {contract:"Factory",event:"LaunchEconomicsSnapshotted",srcAddress:factory,block:{number:1},params:{token,supply:1_000n,phantomQuote:100n,graduationThreshold:250n,baseBps:100n,creatorTaxBps:0n,protocolShareBps:3000n,buybackShareBps:5000n,buybackEnabled:false,dividendVault:zero,dividendShareBps:0n}},
    {contract:"Token",event:"Transfer",srcAddress:token,block:{number:2},params:{from:curve,to:creator,value:100n}},
    {contract:"Curve",event:"CurveBuy",srcAddress:curve,block:{number:2},params:{buyer:creator,recipient:creator,tokensOut:100n,quoteSpent:12n,quoteRefund:0n,baseFee:1n,creatorTax:0n,snipeTax:0n,realQuoteReserve:11n,tokenReserve:900n}},
    {contract:"FeeVault",event:"FeeCredited",srcAddress:feeVault,block:{number:3},params:{token,asset:zero,beneficiary:creator,amount:7n}},
    {contract:"FeeVault",event:"Claimed",srcAddress:feeVault,block:{number:4},params:{token,asset:zero,beneficiary:creator,amount:7n}}
  ]}}});
  const launch=await test.Launch.getOrThrow(token);
  expect(launch.name).toBe("Original");expect(launch.registered).toBe(true);expect(launch.supply).toBe(1_000n);expect(launch.tradeCount).toBe(1n);expect(launch.realQuoteReserve).toBe(11n);
  expect(launch.creatorFeeRecipient).toBe(externalRouter);
  expect((await test.Holder.getOrThrow(`${token}:${creator}`)).balance).toBe(100n);
  expect((await test.FeeBalance.getOrThrow(`${token}:${zero}:${creator}`)).balance).toBe(0n);
});

it("reconstructs native quote approval and default economics from factory initialization events",async()=>{
  const test=createTestIndexer();
  await test.process({chains:{143:{simulate:[
    {contract:"Factory",event:"QuoteAssetUpdated",srcAddress:factory,block:{number:1},params:{asset:zero,approved:true,decimals:18n}},
    {contract:"Factory",event:"PairTokenEconomicsUpdated",srcAddress:factory,block:{number:2},params:{asset:zero,phantomQuote:168n,graduationThreshold:420n}}
  ]}}});
  const native=await test.QuoteAsset.getOrThrow(zero);
  expect(native.approved).toBe(true);expect(native.decimals).toBe(18);expect(native.phantomQuote).toBe(168n);expect(native.graduationThreshold).toBe(420n);
});

it("attributes routed curve and pool trades to the wallet without doubling volume",async()=>{
  const test=createTestIndexer();await seedLaunch(test);
  const tx=`0x${"da".repeat(32)}` as `0x${string}`;
  await test.process({chains:{143:{simulate:[
    {contract:"Curve",event:"CurveBuy",srcAddress:curve,block:{number:2},transaction:{hash:tx},logIndex:1,params:{buyer:externalRouter,recipient:creator,tokensOut:100n,quoteSpent:12n,quoteRefund:3n,baseFee:1n,creatorTax:0n,snipeTax:0n,realQuoteReserve:11n,tokenReserve:900n}},
    {contract:"PaymentRouter",event:"RoutedTrade",srcAddress:externalRouter,block:{number:2},transaction:{hash:tx},logIndex:5,params:{token,trader:creator,paymentAsset:zero,buy:true,phase:0n,quoteAmount:12n,tokenAmount:100n,paymentAmount:15n,refundAsset:zero,refundAmount:3n}},
    {contract:"SwapRouter",event:"PoolTrade",srcAddress:router,block:{number:2},transaction:{hash:tx},logIndex:6,params:{token,trader:externalRouter,recipient:externalRouter,buy:false,amountIn:10n,amountOut:2n}},
    {contract:"PaymentRouter",event:"RoutedTrade",srcAddress:externalRouter,block:{number:2},transaction:{hash:tx},logIndex:7,params:{token,trader:creator,paymentAsset:zero,buy:false,phase:2n,quoteAmount:2n,tokenAmount:10n,paymentAmount:1n,refundAsset:token,refundAmount:0n}},
  ]}}});
  const rows=await test.Trade.getAll();expect(rows).toHaveLength(2);expect(rows.every(row=>row.trader===creator&&row.recipient===creator)).toBe(true);
  expect(rows.find(row=>row.side==='buy')?.baseFee).toBe(1n);
  expect((await test.Launch.getOrThrow(token)).tradeCount).toBe(2n);
  expect((await test.Launch.getOrThrow(token)).quoteVolume).toBe(14n);
  expect(await test.RoutedPayment.getAll()).toHaveLength(2);
});

it("retains the legacy holder base share instead of relabelling historical launches",async()=>{
  const test=createTestIndexer();await seedLaunch(test,dividends);
  const launch=await test.Launch.getOrThrow(token);
  expect(launch).toMatchObject({holderFeeMode:1,dividendShareBps:2000n,dividendTaxShareBps:0n,baseFeeBps:100n,protocolShareBps:3000n,buybackEnabled:false});
});

it.each([true,false])("uses the explicit full holder policy with snapshot before=%s",async(snapshotFirst)=>{
  const test=createTestIndexer();await seedLaunch(test);
  const snapshot={contract:"Factory" as const,event:"LaunchEconomicsSnapshotted" as const,srcAddress:factory as Address,block:{number:snapshotFirst?2:3},params:{token:token as Address,supply:1000n,phantomQuote:100n,graduationThreshold:250n,baseBps:100n,creatorTaxBps:500n,protocolShareBps:3000n,buybackShareBps:5000n,buybackEnabled:false,dividendVault:dividends as Address,dividendShareBps:10000n}};
  const policy={contract:"Factory" as const,event:"HolderFeeSharingConfigured" as const,srcAddress:factory as Address,block:{number:snapshotFirst?3:2},params:{token:token as Address,vault:dividends as Address,mode:2n,baseShareBps:10000n,taxShareBps:10000n}};
  await test.process({chains:{143:{simulate:snapshotFirst?[snapshot,policy]:[policy,snapshot]}}});
  expect(await test.Launch.getOrThrow(token)).toMatchObject({holderFeeMode:2,dividendShareBps:10000n,dividendTaxShareBps:10000n,creatorTaxBps:500n,protocolShareBps:3000n});
});

it("tracks the latest buyback toggle without changing the legacy holder allocation",async()=>{
  const test=createTestIndexer();await seedLaunch(test,dividends);
  await test.process({chains:{143:{simulate:[{contract:"Factory",event:"BuybackEnabledUpdated",srcAddress:factory,block:{number:2},params:{token,enabled:true}}]}}});
  expect(await test.Launch.getOrThrow(token)).toMatchObject({buybackEnabled:true,holderFeeMode:1,dividendShareBps:2000n,dividendTaxShareBps:0n});
  await test.process({chains:{143:{simulate:[{contract:"Factory",event:"BuybackEnabledUpdated",srcAddress:factory,block:{number:3},params:{token,enabled:false}}]}}});
  expect(await test.Launch.getOrThrow(token)).toMatchObject({buybackEnabled:false,holderFeeMode:1});
});
