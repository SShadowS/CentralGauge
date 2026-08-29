codeunit 89380 "CG-AL-X160 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure ClearFixture()
    var
        Wallet: Record "CG X160 Wallet";
        WalletEntry: Record "CG X160 Wallet Entry";
    begin
        Wallet.DeleteAll();
        WalletEntry.DeleteAll();
    end;

    local procedure SeedWallet(No: Code[20]; Balance: Decimal)
    var
        Wallet: Record "CG X160 Wallet";
    begin
        Wallet.Init();
        Wallet."No." := No;
        Wallet.Balance := Balance;
        // Nonzero-checkable sentinel: an untouched wallet must keep this exactly.
        Wallet."Total Charged" := 0;
        Wallet.Insert();
    end;

    local procedure EntryCountFor(WalletNo: Code[20]): Integer
    var
        WalletEntry: Record "CG X160 Wallet Entry";
    begin
        WalletEntry.SetRange("Wallet No.", WalletNo);
        exit(WalletEntry.Count());
    end;

    local procedure GetLastEntry(WalletNo: Code[20]; var WalletEntry: Record "CG X160 Wallet Entry")
    begin
        WalletEntry.SetRange("Wallet No.", WalletNo);
        Assert.IsTrue(WalletEntry.FindLast(), StrSubstNo('Expected at least one ledger entry for wallet %1', WalletNo));
    end;

    [Test]
    procedure ChargingTakesMoneyOutAndUpdatesTheRunningTotal()
    var
        Wallet: Record "CG X160 Wallet";
        WalletMgt: Codeunit "CG X160 Wallet Mgt";
        Entry: Record "CG X160 Wallet Entry";
    begin
        // [SCENARIO] A charge against a funded wallet succeeds
        ClearFixture();
        SeedWallet('W-01', 500);

        WalletMgt.PostCharge('W-01', 120);

        Wallet.Get('W-01');
        Assert.AreEqual(380.0, Wallet.Balance, 'Expected the charge to reduce the wallet''s balance');
        Assert.AreEqual(120.0, Wallet."Total Charged", 'Expected the charge to add to the wallet''s running total');
        GetLastEntry('W-01', Entry);
        Assert.AreEqual(120.0, Entry.Amount, 'Expected the ledger entry to record the charged amount');
    end;

    [Test]
    procedure ChargingMoreThanTheBalanceIsRefused()
    var
        WalletMgt: Codeunit "CG X160 Wallet Mgt";
    begin
        // [SCENARIO] A charge larger than what is available is refused
        ClearFixture();
        SeedWallet('W-02', 100);

        asserterror WalletMgt.PostCharge('W-02', 100.01);

        Assert.ExpectedError('W-02');
    end;

    [Test]
    procedure ChargingExactlyTheBalanceSucceeds()
    var
        Wallet: Record "CG X160 Wallet";
        WalletMgt: Codeunit "CG X160 Wallet Mgt";
    begin
        // [SCENARIO] A charge for exactly what is available is allowed
        ClearFixture();
        SeedWallet('W-03', 75);

        WalletMgt.PostCharge('W-03', 75);

        Wallet.Get('W-03');
        Assert.AreEqual(0.0, Wallet.Balance, 'Expected the wallet to be drawn down to zero exactly');
    end;

    [Test]
    procedure ChargingANonPositiveAmountIsRefused()
    var
        WalletMgt: Codeunit "CG X160 Wallet Mgt";
    begin
        // [SCENARIO] Zero and negative charge amounts are both rejected
        ClearFixture();
        SeedWallet('W-04', 500);
        Commit();

        asserterror WalletMgt.PostCharge('W-04', 0);
        Commit();
        asserterror WalletMgt.PostCharge('W-04', -10);
    end;

    [Test]
    procedure ChargingAnUnknownWalletFails()
    var
        WalletMgt: Codeunit "CG X160 Wallet Mgt";
    begin
        // [SCENARIO] There is no such wallet to charge
        ClearFixture();

        asserterror WalletMgt.PostCharge('NOPE', 10);

        Assert.ExpectedError('NOPE');
    end;

    [Test]
    procedure RefundingPutsMoneyBackWithoutTouchingTheRunningTotal()
    var
        Wallet: Record "CG X160 Wallet";
        WalletMgt: Codeunit "CG X160 Wallet Mgt";
        Entry: Record "CG X160 Wallet Entry";
    begin
        // [SCENARIO] A refund against a charge that was made puts the money back
        ClearFixture();
        SeedWallet('W-05', 500);
        WalletMgt.PostCharge('W-05', 200);

        WalletMgt.PostRefund('W-05', 80);

        Wallet.Get('W-05');
        Assert.AreEqual(380.0, Wallet.Balance, 'Expected the refund to put the money back on the wallet''s balance');
        Assert.AreEqual(200.0, Wallet."Total Charged",
            'Expected the wallet''s running total to still reflect only what was charged');
        GetLastEntry('W-05', Entry);
        Assert.AreEqual("CG X160 Entry Type"::Refund, Entry."Entry Type",
            'Expected the newest ledger entry to record a refund');
        Assert.AreEqual(80.0, Entry.Amount, 'Expected the ledger entry to record the refunded amount');
    end;

    [Test]
    procedure RefundingWithNothingEverChargedIsRefused()
    var
        WalletMgt: Codeunit "CG X160 Wallet Mgt";
    begin
        // [SCENARIO] A generously funded wallet that has never actually been charged
        ClearFixture();
        SeedWallet('W-06', 5000);

        asserterror WalletMgt.PostRefund('W-06', 50);

        Assert.ExpectedError('W-06');
    end;

    [Test]
    procedure RefundsCannotExceedWhatWasActuallyCharged()
    var
        Wallet: Record "CG X160 Wallet";
        WalletMgt: Codeunit "CG X160 Wallet Mgt";
    begin
        // [SCENARIO] Two partial refunds are given back, then a third goes too far
        ClearFixture();
        SeedWallet('W-07', 1000);
        WalletMgt.PostCharge('W-07', 100);

        WalletMgt.PostRefund('W-07', 40);
        WalletMgt.PostRefund('W-07', 40);
        Commit();
        asserterror WalletMgt.PostRefund('W-07', 30);

        Wallet.Get('W-07');
        Assert.AreEqual(980.0, Wallet.Balance,
            'Expected only the two successful refunds to have reached the wallet''s balance');
        Assert.AreEqual(3, EntryCountFor('W-07'), 'Expected the refused refund not to have added a ledger entry');
    end;

    [Test]
    procedure ARefundForExactlyWhatRemainsSucceedsButNoMoreThanThatDoes()
    var
        Wallet: Record "CG X160 Wallet";
        WalletMgt: Codeunit "CG X160 Wallet Mgt";
    begin
        // [SCENARIO] A refund for precisely what remains is allowed; one cent more is not
        ClearFixture();
        SeedWallet('W-08', 1000);
        WalletMgt.PostCharge('W-08', 60);
        WalletMgt.PostRefund('W-08', 20);

        WalletMgt.PostRefund('W-08', 40);

        Wallet.Get('W-08');
        Assert.AreEqual(1000.0, Wallet.Balance, 'Expected the wallet to be made fully whole again');

        Commit();
        asserterror WalletMgt.PostRefund('W-08', 0.01);
    end;

    [Test]
    procedure ANonPositiveRefundAmountIsRefused()
    var
        WalletMgt: Codeunit "CG X160 Wallet Mgt";
    begin
        // [SCENARIO] Zero and negative refund amounts are both rejected
        ClearFixture();
        SeedWallet('W-10', 500);
        WalletMgt.PostCharge('W-10', 200);
        Commit();

        asserterror WalletMgt.PostRefund('W-10', 0);
        Commit();
        asserterror WalletMgt.PostRefund('W-10', -5);
    end;

    [Test]
    procedure RefundingAnUnknownWalletFails()
    var
        WalletMgt: Codeunit "CG X160 Wallet Mgt";
    begin
        // [SCENARIO] There is no such wallet to refund
        ClearFixture();

        asserterror WalletMgt.PostRefund('NOPE', 10);

        Assert.ExpectedError('NOPE');
    end;

    [Test]
    procedure RefundingOneWalletLeavesAnotherWalletsFiguresAlone()
    var
        WalletA: Record "CG X160 Wallet";
        WalletB: Record "CG X160 Wallet";
        WalletMgt: Codeunit "CG X160 Wallet Mgt";
    begin
        // [SCENARIO] Two wallets are charged and only one of them is refunded
        ClearFixture();
        SeedWallet('W-11A', 500);
        SeedWallet('W-11B', 500);
        WalletMgt.PostCharge('W-11A', 100);
        WalletMgt.PostCharge('W-11B', 100);

        WalletMgt.PostRefund('W-11A', 40);

        WalletA.Get('W-11A');
        Assert.AreEqual(440.0, WalletA.Balance, 'Expected the refunded wallet to carry its own new balance');
        WalletB.Get('W-11B');
        Assert.AreEqual(400.0, WalletB.Balance, 'Expected the other wallet''s balance to be left exactly as it was');
        Assert.AreEqual(100.0, WalletB."Total Charged",
            'Expected the other wallet''s running total to be left exactly as it was');
        Assert.AreEqual(1, EntryCountFor('W-11B'), 'Expected the other wallet''s ledger to carry only its own entry');
    end;
}
