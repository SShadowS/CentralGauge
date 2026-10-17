codeunit 87200 "HX087 Purge Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure PurgesOnlySentInFilter()
    var
        Entry: Record "CGR Outbox Entry";
        Spy: Codeunit "HX087 Archive Spy";
        Runner: Codeunit "HX087 Purge Runner";
        S1: Integer;
        S2: Integer;
        P: Integer;
        F: Integer;
        O: Integer;
        Ok: Boolean;
    begin
        HX087InitRun();
        S1 := HX087Queue('HX087-1A', true, false, 0, 20270102D);
        S2 := HX087Queue('HX087-1B', true, false, 0, 20270103D);
        P := HX087Queue('HX087-1C', false, false, 0, 20270104D);
        F := HX087Queue('HX087-1D', false, true, 3, 20270105D);
        O := HX087Queue('HX087-X1', true, false, 0, 20270106D);
        BindSubscription(Spy);

        Runner.HX087SetEntries('HX087-1*', 10, false);
        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'The purge runs: ' + GetLastErrorText());
        Assert.AreEqual(2, Runner.HX087Purged(), 'Two sent entries in the filter are purged');
        Assert.IsFalse(HX087Stored(S1), 'S1 (sent, in the filter) is purged');
        Assert.IsFalse(HX087Stored(S2), 'S2 (sent, in the filter) is purged');
        Assert.IsTrue(HX087Stored(P), 'The pending entry stays');
        Assert.IsTrue(HX087Stored(F), 'The failed, unsent entry stays');
        Assert.IsTrue(HX087Stored(O), 'The sent entry outside the filter stays');
        Entry.SetFilter("Vehicle No.", 'HX087-1*');
        Assert.AreEqual(Entry.GetFilters(), Runner.HX087FiltersAfter(), 'The filters of EntryFilter are not changed');
        Assert.AreEqual(2, Spy.HX087SeenCount(), 'OnBeforePurgeEntry is raised once per purged entry');
        Assert.IsTrue(Spy.HX087Saw(S1), 'OnBeforePurgeEntry is raised for S1');
        Assert.IsTrue(Spy.HX087Saw(S2), 'OnBeforePurgeEntry is raised for S2');
        Assert.IsTrue(Spy.HX087AllStored(), 'OnBeforePurgeEntry is raised before the entry is purged');
    end;

    [Test]
    procedure CompletedChunksStay()
    var
        Spy: Codeunit "HX087 Archive Spy";
        Runner: Codeunit "HX087 Purge Runner";
        Nos: List of [Integer];
        Ok: Boolean;
        RunError: Text;
    begin
        HX087InitRun();
        HX087QueueSent('HX087-2', 5, Nos);
        Spy.HX087Refuse(Nos.Get(4));
        BindSubscription(Spy);

        Runner.HX087SetEntries('HX087-2', 2, false);
        Commit();
        Ok := Runner.Run();
        RunError := GetLastErrorText();

        Assert.IsFalse(Ok, 'The refused entry fails the purge');
        Assert.AreEqual(HX087RefusedText(Nos.Get(4)), RunError, 'The archive app''s error ends the purge');
        Assert.IsFalse(HX087Stored(Nos.Get(1)), 'S1 (first chunk) stays purged');
        Assert.IsFalse(HX087Stored(Nos.Get(2)), 'S2 (first chunk) stays purged');
        Assert.IsTrue(HX087Stored(Nos.Get(3)), 'S3 (failing chunk) stays');
        Assert.IsTrue(HX087Stored(Nos.Get(4)), 'S4 (refused) stays');
        Assert.IsTrue(HX087Stored(Nos.Get(5)), 'S5 (not reached) stays');
        Assert.IsTrue(HX087HasMarker(Nos.Get(1)), 'The archive record of S1 stays');
        Assert.IsTrue(HX087HasMarker(Nos.Get(2)), 'The archive record of S2 stays');
        Assert.IsFalse(HX087HasMarker(Nos.Get(3)), 'The archive record of S3 (failing chunk) is undone');
    end;

    [Test]
    procedure ChunkSizeOne()
    var
        Spy: Codeunit "HX087 Archive Spy";
        Runner: Codeunit "HX087 Purge Runner";
        Nos: List of [Integer];
        Ok: Boolean;
        RunError: Text;
    begin
        HX087InitRun();
        HX087QueueSent('HX087-3', 5, Nos);
        Spy.HX087Refuse(Nos.Get(3));
        BindSubscription(Spy);

        Runner.HX087SetEntries('HX087-3', 1, false);
        Commit();
        Ok := Runner.Run();
        RunError := GetLastErrorText();

        Assert.IsFalse(Ok, 'The refused entry fails the purge');
        Assert.AreEqual(HX087RefusedText(Nos.Get(3)), RunError, 'The archive app''s error ends the purge');
        Assert.IsFalse(HX087Stored(Nos.Get(1)), 'S1 stays purged');
        Assert.IsFalse(HX087Stored(Nos.Get(2)), 'S2 stays purged');
        Assert.IsTrue(HX087Stored(Nos.Get(3)), 'S3 (refused) stays');
        Assert.IsTrue(HX087Stored(Nos.Get(4)), 'S4 stays');
        Assert.IsTrue(HX087Stored(Nos.Get(5)), 'S5 stays');
    end;

    [Test]
    procedure ChunkSizeZeroIsOneChunk()
    var
        Spy: Codeunit "HX087 Archive Spy";
        Runner: Codeunit "HX087 Purge Runner";
        Nos: List of [Integer];
        i: Integer;
        Ok: Boolean;
        RunError: Text;
    begin
        HX087InitRun();
        HX087QueueSent('HX087-4', 5, Nos);
        Spy.HX087Refuse(Nos.Get(3));
        BindSubscription(Spy);

        Runner.HX087SetEntries('HX087-4', 0, false);
        Commit();
        Ok := Runner.Run();
        RunError := GetLastErrorText();

        Assert.IsFalse(Ok, 'The refused entry fails the purge');
        Assert.AreEqual(HX087RefusedText(Nos.Get(3)), RunError, 'The archive app''s error ends the purge');
        for i := 1 to 5 do
            Assert.IsTrue(HX087Stored(Nos.Get(i)), StrSubstNo('S%1 stays: chunk size 0 is one chunk', i));
        Assert.IsFalse(HX087HasAnyMarker(), 'No archive record stays');
    end;

    [Test]
    procedure LastChunkFinal()
    var
        Spy: Codeunit "HX087 Archive Spy";
        Runner: Codeunit "HX087 Purge Runner";
        Nos: List of [Integer];
        i: Integer;
        Ok: Boolean;
        RunError: Text;
    begin
        HX087InitRun();
        HX087QueueSent('HX087-5', 3, Nos);
        BindSubscription(Spy);

        Runner.HX087SetEntries('HX087-5', 2, true);
        Commit();
        Ok := Runner.Run();
        RunError := GetLastErrorText();

        Assert.IsFalse(Ok, 'The later step fails the caller''s transaction');
        Assert.AreEqual('HX087 later step failed.', RunError, 'The later step''s error ends the run');
        Assert.AreEqual(3, Runner.HX087Purged(), 'The purge returned 3');
        for i := 1 to 3 do
            Assert.IsFalse(HX087Stored(Nos.Get(i)), StrSubstNo('S%1 stays purged after the caller fails', i));
    end;

    [Test]
    procedure ChunkBoundaryExact()
    var
        Spy: Codeunit "HX087 Archive Spy";
        Runner: Codeunit "HX087 Purge Runner";
        Nos: List of [Integer];
        i: Integer;
        Ok: Boolean;
        RunError: Text;
    begin
        HX087InitRun();
        HX087QueueSent('HX087-6', 5, Nos);
        Spy.HX087Refuse(Nos.Get(4));
        BindSubscription(Spy);

        Runner.HX087SetEntries('HX087-6', 3, false);
        Commit();
        Ok := Runner.Run();
        RunError := GetLastErrorText();

        Assert.IsFalse(Ok, 'The refused entry fails the purge');
        Assert.AreEqual(HX087RefusedText(Nos.Get(4)), RunError, 'The archive app''s error ends the purge');
        for i := 1 to 3 do
            Assert.IsFalse(HX087Stored(Nos.Get(i)), StrSubstNo('S%1 (first chunk of 3) stays purged', i));
        Assert.IsTrue(HX087Stored(Nos.Get(4)), 'S4 (refused) stays');
        Assert.IsTrue(HX087Stored(Nos.Get(5)), 'S5 stays');
    end;

    [Test]
    procedure VehiclePurgeAsToday()
    var
        Spy: Codeunit "HX087 Archive Spy";
        Runner: Codeunit "HX087 Purge Runner";
        S1: Integer;
        S2: Integer;
        P: Integer;
        S3: Integer;
        Ok: Boolean;
    begin
        HX087InitRun();
        S1 := HX087Queue('HX087-7V', true, false, 0, 20270102D);
        S2 := HX087Queue('HX087-7V', true, false, 0, 20270103D);
        P := HX087Queue('HX087-7V', false, false, 0, 20270104D);
        S3 := HX087Queue('HX087-7W', true, false, 0, 20270105D);
        BindSubscription(Spy);

        Runner.HX087SetVehicle('HX087-7V');
        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'PurgeSentForVehicle runs: ' + GetLastErrorText());
        Assert.AreEqual(2, Runner.HX087Purged(), 'PurgeSentForVehicle returns 2');
        Assert.IsFalse(HX087Stored(S1), 'S1 of the vehicle is purged');
        Assert.IsFalse(HX087Stored(S2), 'S2 of the vehicle is purged');
        Assert.IsTrue(HX087Stored(P), 'The pending entry of the vehicle stays');
        Assert.IsTrue(HX087Stored(S3), 'The sent entry of another vehicle stays');
    end;

    [Test]
    procedure CreatedBeforePurgeAsToday()
    var
        Spy: Codeunit "HX087 Archive Spy";
        Runner: Codeunit "HX087 Purge Runner";
        S1: Integer;
        S2: Integer;
        P: Integer;
        Ok: Boolean;
    begin
        HX087InitRun();
        S1 := HX087Queue('HX087-8A', true, false, 0, 20270101D);
        S2 := HX087Queue('HX087-8B', true, false, 0, 20270201D);
        P := HX087Queue('HX087-8C', false, false, 0, 20270102D);
        BindSubscription(Spy);

        Runner.HX087SetBefore(CreateDateTime(20270115D, 120000T));
        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'PurgeSentBefore runs: ' + GetLastErrorText());
        Assert.AreEqual(1, Runner.HX087Purged(), 'PurgeSentBefore returns 1');
        Assert.IsFalse(HX087Stored(S1), 'The sent entry created before the time is purged');
        Assert.IsTrue(HX087Stored(S2), 'The sent entry created after the time stays');
        Assert.IsTrue(HX087Stored(P), 'The pending entry created before the time stays');
    end;

    [Test]
    procedure ChunkSizeNegativeIsOneChunk()
    var
        Spy: Codeunit "HX087 Archive Spy";
        Runner: Codeunit "HX087 Purge Runner";
        Nos: List of [Integer];
        i: Integer;
        Ok: Boolean;
        RunError: Text;
    begin
        HX087InitRun();
        HX087QueueSent('HX087-9', 3, Nos);
        Spy.HX087Refuse(Nos.Get(3));
        BindSubscription(Spy);

        Runner.HX087SetEntries('HX087-9', -2, false);
        Commit();
        Ok := Runner.Run();
        RunError := GetLastErrorText();

        Assert.IsFalse(Ok, 'The refused entry fails the purge');
        Assert.AreEqual(HX087RefusedText(Nos.Get(3)), RunError, 'The archive app''s error ends the purge');
        for i := 1 to 3 do
            Assert.IsTrue(HX087Stored(Nos.Get(i)), StrSubstNo('S%1 stays: chunk size -2 is one chunk', i));
    end;

    [Test]
    procedure PurgeSentAsToday()
    var
        Spy: Codeunit "HX087 Archive Spy";
        Runner: Codeunit "HX087 Purge Runner";
        S1: Integer;
        P: Integer;
        F: Integer;
        Ok: Boolean;
    begin
        HX087InitRun();
        S1 := HX087Queue('HX087-10A', true, false, 0, 20270102D);
        P := HX087Queue('HX087-10B', false, false, 0, 20270103D);
        F := HX087Queue('HX087-10C', false, true, 3, 20270104D);
        Spy.HX087Refuse(S1);
        BindSubscription(Spy);

        Runner.HX087SetPurgeSent();
        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'PurgeSent runs as today: ' + GetLastErrorText());
        Assert.IsFalse(HX087Stored(S1), 'The sent entry is purged');
        Assert.IsTrue(HX087Stored(P), 'The pending entry stays');
        Assert.IsTrue(HX087Stored(F), 'The failed, unsent entry stays');
        Assert.AreEqual(0, Spy.HX087SeenCount(), 'PurgeSent raises no OnBeforePurgeEntry, as today');
    end;

    [Test]
    procedure VehicleChunksOfFifty()
    var
        Spy: Codeunit "HX087 Archive Spy";
        Runner: Codeunit "HX087 Purge Runner";
        Nos: List of [Integer];
        i: Integer;
        Ok: Boolean;
        RunError: Text;
    begin
        HX087InitRun();
        HX087QueueSent('HX087-11', 51, Nos);
        Spy.HX087Refuse(Nos.Get(51));
        BindSubscription(Spy);

        Runner.HX087SetVehicle('HX087-11');
        Commit();
        Ok := Runner.Run();
        RunError := GetLastErrorText();

        Assert.IsFalse(Ok, 'The refused 51st entry fails PurgeSentForVehicle');
        Assert.AreEqual(HX087RefusedText(Nos.Get(51)), RunError, 'The archive app''s error ends the purge');
        for i := 1 to 50 do
            Assert.IsFalse(HX087Stored(Nos.Get(i)), StrSubstNo('Entry %1 (first chunk of 50) stays purged', i));
        Assert.IsTrue(HX087Stored(Nos.Get(51)), 'The refused 51st entry stays');
    end;

    [Test]
    procedure CreatedBeforeChunksOfFifty()
    var
        Spy: Codeunit "HX087 Archive Spy";
        Runner: Codeunit "HX087 Purge Runner";
        Nos: List of [Integer];
        i: Integer;
        Ok: Boolean;
        RunError: Text;
    begin
        HX087InitRun();
        HX087QueueSent('HX087-12', 51, Nos);
        Spy.HX087Refuse(Nos.Get(51));
        BindSubscription(Spy);

        Runner.HX087SetBefore(CreateDateTime(20270315D, 120000T));
        Commit();
        Ok := Runner.Run();
        RunError := GetLastErrorText();

        Assert.IsFalse(Ok, 'The refused 51st entry fails PurgeSentBefore');
        Assert.AreEqual(HX087RefusedText(Nos.Get(51)), RunError, 'The archive app''s error ends the purge');
        for i := 1 to 50 do
            Assert.IsFalse(HX087Stored(Nos.Get(i)), StrSubstNo('Entry %1 (first chunk of 50) stays purged', i));
        Assert.IsTrue(HX087Stored(Nos.Get(51)), 'The refused 51st entry stays');
    end;

    [Test]
    procedure CallerSentFilterKept()
    var
        Entry: Record "CGR Outbox Entry";
        Spy: Codeunit "HX087 Archive Spy";
        Runner: Codeunit "HX087 Purge Runner";
        S1: Integer;
        P: Integer;
        Ok: Boolean;
    begin
        HX087InitRun();
        S1 := HX087Queue('HX087-13', true, false, 0, 20270102D);
        P := HX087Queue('HX087-13', false, false, 0, 20270103D);
        BindSubscription(Spy);

        Runner.HX087SetEntries('HX087-13', 10, false);
        Runner.HX087SetUnsentOnly();
        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'The purge runs: ' + GetLastErrorText());
        Assert.AreEqual(0, Runner.HX087Purged(), 'No sent entry is within the caller''s filters (Sent = false)');
        Assert.IsTrue(HX087Stored(S1), 'The sent entry outside the caller''s Sent filter stays');
        Assert.IsTrue(HX087Stored(P), 'The unsent entry stays');
        Assert.AreEqual(0, Spy.HX087SeenCount(), 'OnBeforePurgeEntry is raised for no entry');
        Entry.SetFilter("Vehicle No.", 'HX087-13');
        Entry.SetRange(Sent, false);
        Assert.AreEqual(Entry.GetFilters(), Runner.HX087FiltersAfter(), 'The filters of EntryFilter are not changed');
    end;

    [Test]
    procedure CallerGroupTwoSentFilterKept()
    var
        Entry: Record "CGR Outbox Entry";
        Spy: Codeunit "HX087 Archive Spy";
        Runner: Codeunit "HX087 Purge Runner";
        S1: Integer;
        P: Integer;
        Ok: Boolean;
    begin
        HX087InitRun();
        S1 := HX087Queue('HX087-14', true, false, 0, 20270102D);
        P := HX087Queue('HX087-14', false, false, 0, 20270103D);
        BindSubscription(Spy);

        Runner.HX087SetEntries('HX087-14', 10, false);
        Runner.HX087SetUnsentInGroup2();
        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'The purge runs: ' + GetLastErrorText());
        Assert.AreEqual(0, Runner.HX087Purged(), 'No sent entry is within the caller''s filters (Sent = false in filter group 2)');
        Assert.IsTrue(HX087Stored(S1), 'The sent entry outside the caller''s filter group 2 Sent filter stays');
        Assert.IsTrue(HX087Stored(P), 'The unsent entry stays');
        Assert.AreEqual(0, Spy.HX087SeenCount(), 'OnBeforePurgeEntry is raised for no entry');
        Assert.AreEqual(0, Runner.HX087GroupAfter(), 'EntryFilter is left in filter group 0');
        Entry.SetFilter("Vehicle No.", 'HX087-14');
        Assert.AreEqual(Entry.GetFilters(), Runner.HX087FiltersAfter(), 'The filter group 0 filters of EntryFilter are not changed');
        Entry.Reset();
        Entry.SetRange(Sent, false);
        Assert.AreEqual(Entry.GetFilters(), Runner.HX087Group2FiltersAfter(), 'The filter group 2 filters of EntryFilter are not changed');
    end;

    local procedure HX087InitRun()
    var
        Setup: Record "CGR Setup";
        Entry: Record "CGR Outbox Entry";
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270301D);
        Setup.GetOrCreate();
        Setup."Amount Rounding Precision" := 0.01;
        Setup."Default Branch Code" := '';
        Setup."Outbox Max Attempts" := 3;
        Setup."Suspend Rentals" := false;
        Setup.Modify();
        SessionContext.Reset();
        Entry.DeleteAll();
    end;

    local procedure HX087Queue(VehicleNo: Code[20]; IsSent: Boolean; IsFailed: Boolean; AttemptCount: Integer; CreatedOn: Date): Integer
    var
        Entry: Record "CGR Outbox Entry";
        Facade: Codeunit "CGR Integration Facade";
    begin
        Facade.QueueVehicleCheckedOut(VehicleNo);
        Entry.SetRange("Vehicle No.", VehicleNo);
        Entry.FindLast();
        Entry.Sent := IsSent;
        Entry.Failed := IsFailed;
        Entry.Attempts := AttemptCount;
        Entry."Created At" := CreateDateTime(CreatedOn, 120000T);
        Entry.Modify();
        exit(Entry."Entry No.");
    end;

    local procedure HX087QueueSent(VehicleNo: Code[20]; EntryCount: Integer; var Nos: List of [Integer])
    var
        i: Integer;
    begin
        // Sent entries in Entry No. order, created 2027-01-01 + i days (before every cutoff the rows use).
        for i := 1 to EntryCount do
            Nos.Add(HX087Queue(VehicleNo, true, false, 0, 20270101D + i));
    end;

    local procedure HX087Stored(EntryNo: Integer): Boolean
    var
        Entry: Record "CGR Outbox Entry";
    begin
        exit(Entry.Get(EntryNo));
    end;

    local procedure HX087HasMarker(EntryNo: Integer): Boolean
    var
        Entry: Record "CGR Outbox Entry";
    begin
        Entry.SetRange("Vehicle No.", 'HX087-ARC');
        Entry.SetRange("Event Type", 'hx087Archive');
        Entry.SetRange(Payload, Format(EntryNo, 0, 9));
        exit(not Entry.IsEmpty());
    end;

    local procedure HX087HasAnyMarker(): Boolean
    var
        Entry: Record "CGR Outbox Entry";
    begin
        Entry.SetRange("Vehicle No.", 'HX087-ARC');
        exit(not Entry.IsEmpty());
    end;

    local procedure HX087RefusedText(EntryNo: Integer): Text
    begin
        exit('HX087 archive refused ' + Format(EntryNo, 0, 9) + '.');
    end;
}
