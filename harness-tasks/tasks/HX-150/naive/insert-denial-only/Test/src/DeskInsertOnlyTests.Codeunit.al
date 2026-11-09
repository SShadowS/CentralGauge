codeunit 80574 "CGR Desk Insert Only Tests"
{
    Subtype = Test;
    TestPermissions = Restrictive;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        LowerPermissions: Codeunit "Library - Lower Permissions";
        SeedSetTok: Label 'CGR LEDGER SEED IO', Locked = true;
        DeskSetTok: Label 'CGR DESK AGENT', Locked = true;
        DeniedTxt: Label 'the current permissions prevented the action', Locked = true;

    [Test]
    procedure DeskCanPostReturnedContract()
    var
        Contract: Record "CGR Rental Contract";
        Ledger: Record "CGR Rental Ledger Entry";
        Probe: Codeunit "CGR Desk Insert Only Probe";
        ContractNo: Code[20];
        Ok: Boolean;
        Err: Text;
    begin
        ContractNo := HX150ArrangeReturned('HX150-A');
        Probe.SetPost(ContractNo);

        Err := HX150RunAsDesk(Probe, Ok);

        Assert.IsTrue(Ok, 'A desk agent can post a returned contract: ' + Err);
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::Posted, Contract.Status, 'The contract is posted');
        Ledger.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, Ledger.Count(), 'One ledger entry is written for the contract');
    end;

    [Test]
    procedure DeskCanReadLedgerEntries()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        Probe: Codeunit "CGR Desk Insert Only Probe";
        ContractNo: Code[20];
        Ok: Boolean;
        Err: Text;
    begin
        ContractNo := HX150ArrangeReturned('HX150-B');
        RentalMgt.Post(ContractNo);
        Probe.SetRead(ContractNo);

        Err := HX150RunAsDesk(Probe, Ok);

        Assert.IsTrue(Ok, 'A desk agent can read rental ledger entries: ' + Err);
        Assert.IsTrue(Probe.Found(), 'The desk agent sees the ledger entry of the contract');
    end;

    [Test]
    procedure DeskCannotInsertLedgerEntry()
    var
        Ledger: Record "CGR Rental Ledger Entry";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        ContractNo := HX150ArrangeReturned('HX150-C');
        RentalMgt.Post(ContractNo);
        LowerPermissions.PushPermissionSetWithoutDefaults(DeskSetTok);
        Commit();

        Ledger.Init();
        Ledger."Contract No." := ContractNo;
        Ledger.Amount := 1;
        asserterror Ledger.Insert();

        Assert.IsTrue(GetLastErrorText().Contains(DeniedTxt), 'The insert is refused by permissions: ' + GetLastErrorText());
        LowerPermissions.PushPermissionSetWithoutDefaults(SeedSetTok);
        Ledger.Reset();
        Ledger.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, Ledger.Count(), 'Only the posted entry exists');
    end;

    local procedure HX150ArrangeReturned(VehicleNo: Code[20]): Code[20]
    begin
        LowerPermissions.PushPermissionSetWithoutDefaults(SeedSetTok);
        Lib.SetPricing(0, 100, 1);
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate(VehicleNo, 50);
        Lib.ClearOutbox(VehicleNo);
        Lib.ClearLedgerEntries(VehicleNo);
        exit(Lib.CreateReturnedContract(VehicleNo, 20270301D, 20270303D, 1100));
    end;

    local procedure HX150RunAsDesk(var Probe: Codeunit "CGR Desk Insert Only Probe"; var Ok: Boolean): Text
    var
        Err: Text;
    begin
        LowerPermissions.PushPermissionSetWithoutDefaults(DeskSetTok);
        Commit();
        ClearLastError();
        Ok := Probe.Run();
        Err := GetLastErrorText();
        LowerPermissions.PushPermissionSetWithoutDefaults(SeedSetTok);
        exit(Err);
    end;
}
