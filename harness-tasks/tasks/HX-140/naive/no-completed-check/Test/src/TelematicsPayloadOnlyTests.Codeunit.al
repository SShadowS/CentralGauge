codeunit 80488 "CGR Telematics Payload Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure PayloadOnlySyncAllMarksAndSkipsBlocked()
    var
        Spy: Codeunit "CGR PayloadOnly Telematics Spy";
        TelematicsSync: Codeunit "CGR Telematics Sync";
    begin
        WorkDate(20250310D);
        PayloadOnlyVehicle('HX140-G1', false);
        PayloadOnlyVehicle('HX140-G2', true);
        BindSubscription(Spy);

        TelematicsSync.SyncAll();
        UnbindSubscription(Spy);

        Assert.AreEqual(1, Spy.PayloadOnlyCount('HX140-G1'), 'G1 is sent');
        Assert.AreEqual(0, Spy.PayloadOnlyCount('HX140-G2'), 'Blocked G2 is not sent');
        Assert.IsTrue(Spy.PayloadOnlyMarked('HX140-G1'), 'G1 is marked batch');
    end;

    [Test]
    procedure PayloadOnlySingleSyncUnmarked()
    var
        Spy: Codeunit "CGR PayloadOnly Telematics Spy";
        TelematicsSync: Codeunit "CGR Telematics Sync";
    begin
        WorkDate(20250310D);
        PayloadOnlyVehicle('HX140-G3', false);
        BindSubscription(Spy);

        TelematicsSync.SyncVehicle('HX140-G3');
        UnbindSubscription(Spy);

        Assert.AreEqual(1, Spy.PayloadOnlyCount('HX140-G3'), 'One payload');
        Assert.IsFalse(Spy.PayloadOnlyMarked('HX140-G3'), 'A single sync is not marked batch');
    end;

    [Test]
    procedure PayloadOnlyRefusalThenSingleSync()
    var
        Spy: Codeunit "CGR PayloadOnly Telematics Spy";
        TelematicsSync: Codeunit "CGR Telematics Sync";
    begin
        WorkDate(20250310D);
        PayloadOnlyVehicle('HX140-G4', false);
        PayloadOnlyVehicle('HX140-G5', false);
        Spy.PayloadOnlyRefuse('HX140-G5');
        BindSubscription(Spy);

        Commit();
        asserterror TelematicsSync.SyncAll();
        Assert.ExpectedError(Spy.PayloadOnlyRefusalText('HX140-G5'));

        Spy.PayloadOnlyRefuse('');
        TelematicsSync.SyncVehicle('HX140-G4');
        UnbindSubscription(Spy);

        Assert.IsFalse(Spy.PayloadOnlyMarked('HX140-G4'), 'A single sync after a failed SyncAll is not marked batch');
    end;

    local procedure PayloadOnlyVehicle(VehicleNo: Code[20]; Blocked: Boolean)
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        Vehicle.Get(VehicleNo);
        Vehicle.Blocked := Blocked;
        Vehicle.Modify();
    end;
}
