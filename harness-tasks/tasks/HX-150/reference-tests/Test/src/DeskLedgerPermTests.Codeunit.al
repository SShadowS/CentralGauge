codeunit 80570 "CGR Desk Ledger Perm Tests"
{
    Subtype = Test;
    TestPermissions = Restrictive;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        LowerPermissions: Codeunit "Library - Lower Permissions";
        SeedSetTok: Label 'CGR LEDGER TEST SEED', Locked = true;
        DeskSetTok: Label 'CGR DESK AGENT', Locked = true;
        DeniedTxt: Label 'the current permissions prevented the action', Locked = true;

    [Test]
    procedure DeskCanPostReturnedContract()
    var
        Contract: Record "CGR Rental Contract";
        Ledger: Record "CGR Rental Ledger Entry";
        Probe: Codeunit "CGR Desk Ledger Probe";
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
        Probe: Codeunit "CGR Desk Ledger Probe";
        ContractNo: Code[20];
        Ok: Boolean;
        Err: Text;
    begin
        ContractNo := HX150ArrangePosted('HX150-B');
        Probe.SetRead(ContractNo);

        Err := HX150RunAsDesk(Probe, Ok);

        Assert.IsTrue(Ok, 'A desk agent can read rental ledger entries: ' + Err);
        Assert.IsTrue(Probe.Found(), 'The desk agent sees the ledger entry of the contract');
    end;

    [Test]
    procedure DeskCannotInsertLedgerEntry()
    var
        Ledger: Record "CGR Rental Ledger Entry";
        Probe: Codeunit "CGR Desk Ledger Probe";
        ContractNo: Code[20];
        Ok: Boolean;
        Err: Text;
    begin
        ContractNo := HX150ArrangePosted('HX150-C');
        Probe.SetInsert(ContractNo);

        Err := HX150RunAsDesk(Probe, Ok);

        Assert.IsFalse(Ok, 'A desk agent cannot insert a rental ledger entry directly');
        Assert.IsTrue(Err.Contains(DeniedTxt), 'The insert is refused by permissions: ' + Err);
        Ledger.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, Ledger.Count(), 'Only the posted entry exists');
    end;

    [Test]
    procedure DeskCannotModifyLedgerEntry()
    var
        Ledger: Record "CGR Rental Ledger Entry";
        Probe: Codeunit "CGR Desk Ledger Probe";
        ContractNo: Code[20];
        AmountBefore: Decimal;
        Ok: Boolean;
        Err: Text;
    begin
        ContractNo := HX150ArrangePosted('HX150-D');
        Ledger.SetRange("Contract No.", ContractNo);
        Ledger.FindFirst();
        AmountBefore := Ledger.Amount;
        Probe.SetModify(ContractNo);

        Err := HX150RunAsDesk(Probe, Ok);

        Assert.IsFalse(Ok, 'A desk agent cannot modify a rental ledger entry');
        Assert.IsTrue(Err.Contains(DeniedTxt), 'The modify is refused by permissions: ' + Err);
        Ledger.FindFirst();
        Assert.AreEqual(AmountBefore, Ledger.Amount, 'The ledger entry is unchanged');
    end;

    [Test]
    procedure DeskCannotDeleteLedgerEntry()
    var
        Ledger: Record "CGR Rental Ledger Entry";
        Probe: Codeunit "CGR Desk Ledger Probe";
        ContractNo: Code[20];
        Ok: Boolean;
        Err: Text;
    begin
        ContractNo := HX150ArrangePosted('HX150-E');
        Probe.SetDelete(ContractNo);

        Err := HX150RunAsDesk(Probe, Ok);

        Assert.IsFalse(Ok, 'A desk agent cannot delete a rental ledger entry');
        Assert.IsTrue(Err.Contains(DeniedTxt), 'The delete is refused by permissions: ' + Err);
        Ledger.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, Ledger.Count(), 'The ledger entry still exists');
    end;

    // Every test starts by pushing the seed set (no set carried over from an earlier test), then arranges the setup
    // row, a vehicle with no history and a returned contract on it.
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

    // As above, then posts the contract under the seed set so one ledger entry exists.
    local procedure HX150ArrangePosted(VehicleNo: Code[20]): Code[20]
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        ContractNo := HX150ArrangeReturned(VehicleNo);
        RentalMgt.Post(ContractNo);
        exit(ContractNo);
    end;

    // Runs the action under the desk set only, committed first, then restores the seed set for the asserts.
    local procedure HX150RunAsDesk(var Probe: Codeunit "CGR Desk Ledger Probe"; var Ok: Boolean): Text
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
