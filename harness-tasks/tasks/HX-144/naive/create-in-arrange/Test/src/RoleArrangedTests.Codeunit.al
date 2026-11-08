codeunit 80526 "CGR Role Arranged Tests"
{
    Subtype = Test;
    TestPermissions = Restrictive;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        LowerPermissions: Codeunit "Library - Lower Permissions";
        SeedSetTok: Label 'CGR ROLE CA SEED', Locked = true;
        DeskSetTok: Label 'CGR DESK', Locked = true;
        BackOfficeSetTok: Label 'CGR BACKOFFICE', Locked = true;
        DeniedTxt: Label 'the current permissions prevented the action', Locked = true;

    [Test]
    procedure DeskCanCheckOut()
    var
        Contract: Record "CGR Rental Contract";
        Vehicle: Record "CGR Vehicle";
        Outbox: Record "CGR Outbox Entry";
        Probe: Codeunit "CGR Role Arranged Probe";
        ContractNo: Code[20];
        Ok: Boolean;
        Err: Text;
    begin
        HX144Arrange('HX144-B');
        ContractNo := Lib.CreateContract('HX144-B');
        Probe.SetCheckOut(ContractNo);

        Err := HX144RunAs(DeskSetTok, Probe, Ok);

        Assert.IsTrue(Ok, 'A desk agent can check out a contract: ' + Err);
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::"Checked Out", Contract.Status, 'The contract is checked out');
        Vehicle.Get('HX144-B');
        Assert.IsTrue(Vehicle."Checked Out", 'The vehicle is checked out');
        Outbox.SetRange("Vehicle No.", 'HX144-B');
        Assert.AreEqual(1, Outbox.Count(), 'The check-out is queued once');
    end;

    [Test]
    procedure DeskCanReturnWithDamage()
    var
        Contract: Record "CGR Rental Contract";
        Vehicle: Record "CGR Vehicle";
        Damage: Record "CGR Damage Entry";
        RentalMgt: Codeunit "CGR Rental Mgt";
        Probe: Codeunit "CGR Role Arranged Probe";
        ContractNo: Code[20];
        Ok: Boolean;
        Err: Text;
    begin
        HX144Arrange('HX144-C');
        ContractNo := Lib.CreateContract('HX144-C');
        RentalMgt.CheckOut(ContractNo);
        Probe.SetReturn(ContractNo, 1250, 'HX144 scratched door');

        Err := HX144RunAs(DeskSetTok, Probe, Ok);

        Assert.IsTrue(Ok, 'A desk agent can return a contract with a damage: ' + Err);
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'The contract is returned');
        Damage.SetRange("Vehicle No.", 'HX144-C');
        Assert.AreEqual(1, Damage.Count(), 'The damage is registered');
        Vehicle.Get('HX144-C');
        Assert.IsTrue(Vehicle.Blocked, 'The damaged vehicle is blocked');
        Assert.AreEqual(1250, Vehicle.Mileage, 'The return mileage is stored');
    end;

    [Test]
    procedure DeskCannotPost()
    var
        Contract: Record "CGR Rental Contract";
        Ledger: Record "CGR Rental Ledger Entry";
        Probe: Codeunit "CGR Role Arranged Probe";
        ContractNo: Code[20];
        Ok: Boolean;
        Err: Text;
    begin
        HX144Arrange('HX144-D');
        ContractNo := Lib.CreateReturnedContract('HX144-D', 20270301D, 20270303D, 1100);
        Probe.SetPost(ContractNo);

        Err := HX144RunAs(DeskSetTok, Probe, Ok);

        Assert.IsFalse(Ok, 'A desk agent cannot post a contract');
        Assert.IsTrue(Err.Contains(DeniedTxt), 'The post is refused by permissions: ' + Err);
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'The contract stays returned');
        Ledger.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(0, Ledger.Count(), 'No ledger entry is written');
    end;

    [Test]
    procedure DeskCannotDeleteContract()
    var
        Contract: Record "CGR Rental Contract";
        Probe: Codeunit "CGR Role Arranged Probe";
        ContractNo: Code[20];
        Ok: Boolean;
        Err: Text;
    begin
        HX144Arrange('HX144-E');
        ContractNo := Lib.CreateContract('HX144-E');
        Probe.SetDelete(ContractNo);

        Err := HX144RunAs(DeskSetTok, Probe, Ok);

        Assert.IsFalse(Ok, 'A desk agent cannot delete a rental contract');
        Assert.IsTrue(Err.Contains(DeniedTxt), 'The delete is refused by permissions: ' + Err);
        Assert.IsTrue(Contract.Get(ContractNo), 'The contract still exists');
    end;

    [Test]
    procedure BackOfficeCanPost()
    var
        Contract: Record "CGR Rental Contract";
        Ledger: Record "CGR Rental Ledger Entry";
        Probe: Codeunit "CGR Role Arranged Probe";
        ContractNo: Code[20];
        Ok: Boolean;
        Err: Text;
    begin
        HX144Arrange('HX144-F');
        ContractNo := Lib.CreateReturnedContract('HX144-F', 20270301D, 20270303D, 1100);
        Probe.SetPost(ContractNo);

        Err := HX144RunAs(BackOfficeSetTok, Probe, Ok);

        Assert.IsTrue(Ok, 'A back-office user can post a returned contract: ' + Err);
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::Posted, Contract.Status, 'The contract is posted');
        Ledger.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, Ledger.Count(), 'One ledger entry is written');
    end;

    // Every test starts by pushing the seed set (no set carried over from an earlier test), then arranges the setup
    // row and a vehicle with no history.
    local procedure HX144Arrange(VehicleNo: Code[20])
    begin
        LowerPermissions.PushPermissionSetWithoutDefaults(SeedSetTok);
        Lib.SetPricing(0, 100, 1);
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate(VehicleNo, 50);
        Lib.ClearOutbox(VehicleNo);
        Lib.ClearLedgerEntries(VehicleNo);
    end;

    // Commits the arrange, runs the action under the role set only, then restores the seed set for the asserts.
    local procedure HX144RunAs(RoleSet: Code[20]; var Probe: Codeunit "CGR Role Arranged Probe"; var Ok: Boolean): Text
    var
        Err: Text;
    begin
        LowerPermissions.PushPermissionSetWithoutDefaults(RoleSet);
        Commit();
        ClearLastError();
        Ok := Probe.Run();
        Err := GetLastErrorText();
        LowerPermissions.PushPermissionSetWithoutDefaults(SeedSetTok);
        exit(Err);
    end;
}
