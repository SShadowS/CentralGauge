codeunit 80115 "CGR Posting Event Naive"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure PostCreatesLedgerEntry()
    var
        Entry: Record "CGR Rental Ledger Entry";
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.SetPricing(0, 1000, 0);
        Lib.CreateVehicle('HX064-N01', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate('HX064-N01', 50);
        ContractNo := Lib.CreateContract('HX064-N01');
        RentalMgt.CheckOut(ContractNo);
        RentalMgt.Return(ContractNo, 1200, '');
        RentalMgt.Post(ContractNo);
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::Posted, Contract.Status, 'Posting sets the contract status');
        Entry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, Entry.Count(), 'Posting creates one ledger entry');
        Entry.FindFirst();
        Assert.AreEqual('HX064-N01', Entry."Vehicle No.", 'Ledger entry vehicle');
        Assert.AreEqual(20270303D, Entry."Posting Date", 'Ledger entry is posted on the end date');
        Assert.AreEqual(150.00, Entry.Amount, '3 days x 50');
        Assert.AreEqual(200, Entry."Km Driven", 'Ledger entry km driven');
    end;

    [Test]
    procedure PostedAmountReachesAfterEvent()
    var
        Spy: Codeunit "CGR Posting Event Naive Spy";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.SetPricing(0, 1000, 0);
        Lib.CreateVehicle('HX064-N02', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate('HX064-N02', 50);
        ContractNo := Lib.CreateReturnedContract('HX064-N02', 20270301D, 20270303D, 1200);
        BindSubscription(Spy);
        RentalMgt.Post(ContractNo);
        UnbindSubscription(Spy);
        Assert.AreEqual(150.00, Spy.PostedAmount(), 'OnAfter carries the posted amount');
        Assert.AreEqual(Enum::"CGR Rental Status"::Posted, Spy.PostedStatus(), 'OnAfter gets the posted contract');
    end;
}
