codeunit 80485 "CGR Telematics BatchOnly Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure BatchOnlySyncAllSkipsBlocked()
    var
        Vehicle: Record "CGR Vehicle";
        Spy: Codeunit "CGR Batch Only Telematics Spy";
        TelematicsSync: Codeunit "CGR Telematics Sync";
        Result: Integer;
    begin
        WorkDate(20250310D);
        BatchOnlyVehicle('HX140-F1', false);
        BatchOnlyVehicle('HX140-F2', true);
        BindSubscription(Spy);

        Result := TelematicsSync.SyncAll();
        UnbindSubscription(Spy);

        Vehicle.SetRange(Blocked, false);
        Assert.AreEqual(Vehicle.Count(), Result, 'Result is the number of unblocked vehicles');
        Assert.AreEqual(Result, Spy.BatchOnlyCompletedCount(), 'OnBatchCompleted carries the number sent');
        Assert.AreEqual(1, Spy.BatchOnlyPayloads('HX140-F1'), 'F1 is sent');
        Assert.AreEqual(0, Spy.BatchOnlyPayloads('HX140-F2'), 'Blocked F2 is not sent');
        Assert.IsTrue(Spy.BatchOnlyMarked('HX140-F1'), 'F1 is marked batch');
    end;

    [Test]
    procedure BatchOnlyRefusalThenRerun()
    var
        Spy: Codeunit "CGR Batch Only Telematics Spy";
        Runner: Codeunit "CGR Batch Only Sync Runner";
        RerunRunner: Codeunit "CGR Batch Only Sync Runner";
        Ok: Boolean;
    begin
        WorkDate(20250310D);
        BatchOnlyVehicle('HX140-F3', false);
        BatchOnlyVehicle('HX140-F4', false);
        Spy.BatchOnlyRefuse('HX140-F4');
        BindSubscription(Spy);

        Commit();
        ClearLastError();
        Ok := Runner.Run();
        Assert.IsFalse(Ok, 'A refused vehicle fails SyncAll');
        Assert.AreEqual(Spy.BatchOnlyRefusalText('HX140-F4'), GetLastErrorText(), 'The partner error is kept');
        Assert.AreEqual(0, Spy.BatchOnlyCompletedCalls(), 'No OnBatchCompleted after a refusal');

        Spy.BatchOnlyRefuse('');
        Commit();
        ClearLastError();
        Ok := RerunRunner.Run();
        UnbindSubscription(Spy);

        Assert.IsTrue(Ok, 'SyncAll runs again: ' + GetLastErrorText());
        Assert.IsTrue(Spy.BatchOnlyMarked('HX140-F4'), 'The rerun marks F4 batch');
    end;

    local procedure BatchOnlyVehicle(VehicleNo: Code[20]; Blocked: Boolean)
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        Vehicle.Get(VehicleNo);
        Vehicle.Blocked := Blocked;
        Vehicle.Modify();
    end;
}
