codeunit 80563 "CGR Claim Desk Error Tests"
{
    Subtype = Test;
    TestPermissions = Restrictive;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        DamageMgt: Codeunit "CGR Damage Mgt";
        LowerPermissions: Codeunit "Library - Lower Permissions";
        SeedSetTok: Label 'CGR CLAIM TEST SEED', Locked = true;
        ClaimsSetTok: Label 'CGR CLAIMS HANDLER', Locked = true;
        DeskSetTok: Label 'CGR FRONT DESK', Locked = true;
        DeniedTxt: Label 'the current permissions prevented the action', Locked = true;

    [Test]
    procedure ClaimsHandlerExportsOpenDamages()
    var
        Spy: Codeunit "CGR Claim Insurer Spy";
        Runner: Codeunit "CGR Claim Export Runner";
        First: Integer;
        Second: Integer;
        Ok: Boolean;
        Err: Text;
    begin
        HX149Arrange('HX149-A');
        First := DamageMgt.RegisterDamage('HX149-A', 'HX149 dent');
        Second := DamageMgt.RegisterDamage('HX149-A', 'HX149 scratch');
        BindSubscription(Spy);

        Err := HX149RunAs(ClaimsSetTok, Runner, Ok);

        Assert.IsTrue(Ok, 'A claims handler can run the export: ' + Err);
        Assert.AreEqual(2, Runner.ExportedDamageCount(), 'Both open damages are sent');
        Assert.AreEqual(2, Spy.SentCount(), 'The insurer receives two damages');
        Assert.IsTrue(Spy.WasSent(First), 'The first damage is sent');
        Assert.IsTrue(Spy.WasSent(Second), 'The second damage is sent');
        Assert.IsTrue(IsClaimed(First), 'The first damage is marked Claimed');
        Assert.IsTrue(IsClaimed(Second), 'The second damage is marked Claimed');
    end;

    [Test]
    procedure RepairedDamageIsNotSent()
    var
        Spy: Codeunit "CGR Claim Insurer Spy";
        Runner: Codeunit "CGR Claim Export Runner";
        OpenNo: Integer;
        FixedNo: Integer;
        Ok: Boolean;
        Err: Text;
    begin
        HX149Arrange('HX149-B');
        FixedNo := DamageMgt.RegisterDamage('HX149-B', 'HX149 repaired dent');
        OpenNo := DamageMgt.RegisterDamage('HX149-B', 'HX149 open scratch');
        DamageMgt.RepairDamage(FixedNo);
        BindSubscription(Spy);

        Err := HX149RunAs(ClaimsSetTok, Runner, Ok);

        Assert.IsTrue(Ok, 'The export runs: ' + Err);
        Assert.AreEqual(1, Runner.ExportedDamageCount(), 'Only the unrepaired damage is sent');
        Assert.AreEqual(1, Spy.SentCount(), 'The insurer receives one damage');
        Assert.IsTrue(Spy.WasSent(OpenNo), 'The unrepaired damage is sent');
        Assert.IsFalse(Spy.WasSent(FixedNo), 'The repaired damage is not sent');
        Assert.IsFalse(IsClaimed(FixedNo), 'The repaired damage is not marked Claimed');
    end;

    [Test]
    procedure ClaimedDamageIsNotSentAgain()
    var
        Spy: Codeunit "CGR Claim Insurer Spy";
        FirstRun: Codeunit "CGR Claim Export Runner";
        SecondRun: Codeunit "CGR Claim Export Runner";
        EntryNo: Integer;
        Ok: Boolean;
        Err: Text;
    begin
        HX149Arrange('HX149-C');
        EntryNo := DamageMgt.RegisterDamage('HX149-C', 'HX149 dent');
        BindSubscription(Spy);

        Err := HX149RunAs(ClaimsSetTok, FirstRun, Ok);
        Assert.IsTrue(Ok, 'The first export runs: ' + Err);
        Assert.AreEqual(1, FirstRun.ExportedDamageCount(), 'The first export sends the damage');

        Err := HX149RunAs(ClaimsSetTok, SecondRun, Ok);
        Assert.IsTrue(Ok, 'The second export runs: ' + Err);
        Assert.AreEqual(0, SecondRun.ExportedDamageCount(), 'A claimed damage is not sent again');
        Assert.AreEqual(1, Spy.SentCount(), 'The insurer receives the damage once');
    end;

    [Test]
    procedure RefusalFailsAndClaimsNothing()
    var
        Spy: Codeunit "CGR Claim Insurer Spy";
        First: Integer;
        Second: Integer;
        Err: Text;
    begin
        HX149Arrange('HX149-D');
        First := DamageMgt.RegisterDamage('HX149-D', 'HX149 dent');
        Second := DamageMgt.RegisterDamage('HX149-D', 'HX149 scratch');
        Spy.Refuse(Second);
        BindSubscription(Spy);

        Err := HX149ExportExpectingError(ClaimsSetTok);

        Assert.AreEqual(Spy.RefusalText(), Err, 'The export fails with the insurer''s error');
        Assert.IsFalse(IsClaimed(First), 'The damage sent before the refusal is not marked Claimed');
        Assert.IsFalse(IsClaimed(Second), 'The refused damage is not marked Claimed');
    end;

    [Test]
    procedure FrontDeskCannotExport()
    var
        First: Integer;
        Second: Integer;
        Err: Text;
    begin
        HX149Arrange('HX149-E');
        First := DamageMgt.RegisterDamage('HX149-E', 'HX149 dent');
        Second := DamageMgt.RegisterDamage('HX149-E', 'HX149 scratch');

        Err := HX149ExportExpectingError(DeskSetTok);

        Assert.IsTrue(Err.Contains(DeniedTxt), 'A front-desk agent gets a permission error: ' + Err);
        Assert.IsFalse(IsClaimed(First), 'The first damage is not marked Claimed');
        Assert.IsFalse(IsClaimed(Second), 'The second damage is not marked Claimed');
    end;

    // Every test starts on the seed set (nothing carried over), removes every damage entry (the export reads the whole
    // table) and creates its own vehicle.
    local procedure HX149Arrange(VehicleNo: Code[20])
    var
        Damage: Record "CGR Damage Entry";
    begin
        LowerPermissions.PushPermissionSetWithoutDefaults(SeedSetTok);
        WorkDate(20270301D);
        Damage.DeleteAll();
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
    end;

    // Runs the export through the runner under the role set only, after committing the arrange, then restores the seed set.
    local procedure HX149RunAs(RoleSet: Code[20]; var Runner: Codeunit "CGR Claim Export Runner"; var Ok: Boolean): Text
    var
        Err: Text;
    begin
        LowerPermissions.PushPermissionSetWithoutDefaults(RoleSet);
        Commit();
        ClearLastError();
        Ok := Runner.Run();
        Err := GetLastErrorText();
        LowerPermissions.PushPermissionSetWithoutDefaults(SeedSetTok);
        exit(Err);
    end;

    // Commits the arrange, runs the export under the role set expecting an error, then restores the seed set.
    local procedure HX149ExportExpectingError(RoleSet: Code[20]): Text
    var
        ClaimExport: Codeunit "CGR Claim Export";
        Err: Text;
    begin
        LowerPermissions.PushPermissionSetWithoutDefaults(RoleSet);
        Commit();
        asserterror ClaimExport.ExportOpenDamages();
        Err := GetLastErrorText();
        LowerPermissions.PushPermissionSetWithoutDefaults(SeedSetTok);
        exit(Err);
    end;

    local procedure IsClaimed(EntryNo: Integer): Boolean
    var
        Damage: Record "CGR Damage Entry";
    begin
        Damage.Get(EntryNo);
        exit(Damage.Claimed);
    end;
}
