codeunit 80480 "CGR Telematics Sync Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure SyncAllMarksEverySentPayloadAsBatch()
    var
        Vehicle: Record "CGR Vehicle";
        Spy: Codeunit "CGR Telematics Partner Spy";
        TelematicsSync: Codeunit "CGR Telematics Sync";
        Result: Integer;
    begin
        WorkDate(20250310D);
        HX140Vehicle('HX140-A1', false);
        HX140Vehicle('HX140-A2', true);
        HX140Vehicle('HX140-A3', false);
        BindSubscription(Spy);

        Result := TelematicsSync.SyncAll();
        UnbindSubscription(Spy);

        Vehicle.SetRange(Blocked, false);
        Assert.AreEqual(Vehicle.Count(), Result, 'SyncAll returns the number of vehicles that are not Blocked');
        Assert.AreEqual(1, Spy.BatchCompletedCalls(), 'OnBatchCompleted is raised once');
        Assert.AreEqual(Result, Spy.BatchCompletedVehicleCount(), 'OnBatchCompleted carries the number of vehicles sent');
        Assert.AreEqual(1, Spy.PayloadsSentFor('HX140-A1'), 'An unblocked vehicle is sent once');
        Assert.AreEqual(1, Spy.PayloadsSentFor('HX140-A3'), 'An unblocked vehicle is sent once');
        Assert.AreEqual(0, Spy.PayloadsSentFor('HX140-A2'), 'A Blocked vehicle is not sent');
        Assert.IsTrue(Spy.LastPayloadMarkedBatch('HX140-A1'), 'A SyncAll payload is marked batch');
        Assert.IsTrue(Spy.LastPayloadMarkedBatch('HX140-A3'), 'A SyncAll payload is marked batch');
    end;

    [Test]
    procedure SingleSyncCarriesNoBatchMark()
    var
        Spy: Codeunit "CGR Telematics Partner Spy";
        TelematicsSync: Codeunit "CGR Telematics Sync";
    begin
        WorkDate(20250310D);
        HX140Vehicle('HX140-B1', false);
        BindSubscription(Spy);

        TelematicsSync.SyncVehicle('HX140-B1');
        UnbindSubscription(Spy);

        Assert.AreEqual(1, Spy.PayloadsSentFor('HX140-B1'), 'SyncVehicle sends one payload');
        Assert.IsFalse(Spy.LastPayloadMarkedBatch('HX140-B1'), 'A single sync carries no batch mark');
        Assert.AreEqual(0, Spy.BatchCompletedCalls(), 'A single sync raises no OnBatchCompleted');
    end;

    [Test]
    procedure RefusedSingleSyncFailsWithPartnerError()
    var
        Spy: Codeunit "CGR Telematics Partner Spy";
        TelematicsSync: Codeunit "CGR Telematics Sync";
    begin
        WorkDate(20250310D);
        HX140Vehicle('HX140-D1', false);
        Spy.RefuseTelematicsVehicle('HX140-D1');
        BindSubscription(Spy);

        Commit();
        asserterror TelematicsSync.SyncVehicle('HX140-D1');
        Assert.ExpectedError(Spy.TelematicsRefusalText('HX140-D1'));
        UnbindSubscription(Spy);
    end;

    [Test]
    procedure RefusedVehicleStopsSyncAllAndLeavesNoBatchMark()
    var
        Spy: Codeunit "CGR Telematics Partner Spy";
        TelematicsSync: Codeunit "CGR Telematics Sync";
        Runner: Codeunit "CGR Telematics Sync Runner";
        RerunRunner: Codeunit "CGR Telematics Sync Runner";
        ErrorText: Text;
        Ok: Boolean;
    begin
        WorkDate(20250310D);
        HX140Vehicle('HX140-C1', false);
        HX140Vehicle('HX140-C2', false);
        HX140Vehicle('HX140-C3', false);
        Spy.RefuseTelematicsVehicle('HX140-C2');
        BindSubscription(Spy);

        Commit();
        ClearLastError();
        Ok := Runner.Run();
        ErrorText := GetLastErrorText();

        Assert.IsFalse(Ok, 'SyncAll fails when the partner refuses a vehicle');
        Assert.AreEqual(Spy.TelematicsRefusalText('HX140-C2'), ErrorText, 'SyncAll stops with the partner error');
        Assert.AreEqual(0, Spy.BatchCompletedCalls(), 'OnBatchCompleted is not raised when SyncAll fails');
        Assert.AreEqual(0, Spy.PayloadsSentFor('HX140-C3'), 'SyncAll stops at the refused vehicle');

        Spy.RefuseTelematicsVehicle('');
        TelematicsSync.SyncVehicle('HX140-C1');
        Assert.IsFalse(Spy.LastPayloadMarkedBatch('HX140-C1'), 'A single sync after a failed SyncAll carries no batch mark');

        Commit();
        ClearLastError();
        Ok := RerunRunner.Run();
        ErrorText := GetLastErrorText();
        UnbindSubscription(Spy);

        Assert.IsTrue(Ok, 'SyncAll runs again after a failed SyncAll: ' + ErrorText);
        Assert.AreEqual(1, Spy.BatchCompletedCalls(), 'The second SyncAll completes');
        Assert.IsTrue(Spy.LastPayloadMarkedBatch('HX140-C3'), 'The second SyncAll marks its payloads batch');
    end;

    local procedure HX140Vehicle(VehicleNo: Code[20]; Blocked: Boolean)
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        Vehicle.Get(VehicleNo);
        Vehicle.Blocked := Blocked;
        Vehicle.Modify();
    end;
}
