codeunit 80483 "CGR Telematics Rerun Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure RerunSyncAllMarksPayloads()
    var
        Spy: Codeunit "CGR Rerun Telematics Spy";
        TelematicsSync: Codeunit "CGR Telematics Sync";
        Result: Integer;
    begin
        WorkDate(20250310D);
        Lib.CreateVehicle('HX140-E1', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.CreateVehicle('HX140-E2', 1000, Enum::"CGR Maintenance Strategy"::Default);
        BindSubscription(Spy);

        Result := TelematicsSync.SyncAll();
        UnbindSubscription(Spy);

        Assert.AreEqual(1, Spy.RerunCompletedCalls(), 'OnBatchCompleted is raised once');
        Assert.AreEqual(Result, Spy.RerunCompletedCount(), 'OnBatchCompleted carries the number sent');
        Assert.AreEqual(1, Spy.RerunPayloads('HX140-E1'), 'E1 is sent once');
        Assert.AreEqual(1, Spy.RerunPayloads('HX140-E2'), 'E2 is sent once');
        Assert.IsTrue(Spy.RerunMarkedBatch('HX140-E1'), 'E1 is marked batch');
        Assert.IsTrue(Spy.RerunMarkedBatch('HX140-E2'), 'E2 is marked batch');
    end;

    [Test]
    procedure RerunSingleSyncUnmarked()
    var
        Spy: Codeunit "CGR Rerun Telematics Spy";
        TelematicsSync: Codeunit "CGR Telematics Sync";
    begin
        WorkDate(20250310D);
        Lib.CreateVehicle('HX140-E3', 1000, Enum::"CGR Maintenance Strategy"::Default);
        BindSubscription(Spy);

        TelematicsSync.SyncVehicle('HX140-E3');
        UnbindSubscription(Spy);

        Assert.AreEqual(1, Spy.RerunPayloads('HX140-E3'), 'One payload');
        Assert.IsFalse(Spy.RerunMarkedBatch('HX140-E3'), 'A single sync is not marked batch');
    end;

    [Test]
    procedure RerunAfterRefusalDirect()
    var
        Spy: Codeunit "CGR Rerun Telematics Spy";
        TelematicsSync: Codeunit "CGR Telematics Sync";
    begin
        WorkDate(20250310D);
        Lib.CreateVehicle('HX140-E4', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.CreateVehicle('HX140-E5', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Spy.RerunRefuse('HX140-E5');
        BindSubscription(Spy);

        Commit();
        asserterror TelematicsSync.SyncAll();
        Assert.ExpectedError(Spy.RerunRefusalText('HX140-E5'));
        Assert.AreEqual(0, Spy.RerunCompletedCalls(), 'No OnBatchCompleted after a refusal');

        Spy.RerunRefuse('');
        TelematicsSync.SyncAll();
        UnbindSubscription(Spy);

        Assert.AreEqual(1, Spy.RerunCompletedCalls(), 'SyncAll runs again');
        Assert.IsTrue(Spy.RerunMarkedBatch('HX140-E5'), 'The second SyncAll marks its payloads batch');
    end;
}
