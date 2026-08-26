codeunit 89316 "CG-AL-X122 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods
    // (measured 2026-08-20, SOAP runner), so every test clears both tables
    // before seeding its own rows.
    local procedure ResetAll()
    var
        Document: Record "CG X122 Document";
        Log: Record "CG X122 Activity Log";
    begin
        Document.DeleteAll();
        Log.DeleteAll();
    end;

    local procedure SeedOpenDocument(No: Code[20]; Amount: Decimal)
    var
        Document: Record "CG X122 Document";
    begin
        Document.Init();
        Document."No." := No;
        Document.Amount := Amount;
        Document.Status := Document.Status::Open;
        Document.Insert();
    end;

    local procedure SeedReleasedDocument(No: Code[20]; Amount: Decimal)
    var
        Document: Record "CG X122 Document";
    begin
        Document.Init();
        Document."No." := No;
        Document.Amount := Amount;
        Document.Status := Document.Status::Released;
        Document.Insert();
    end;

    local procedure SeedCancelledDocument(No: Code[20]; Amount: Decimal)
    var
        Document: Record "CG X122 Document";
    begin
        Document.Init();
        Document."No." := No;
        Document.Amount := Amount;
        Document.Status := Document.Status::Cancelled;
        Document.Insert();
    end;

    local procedure StatusOf(No: Code[20]): Text
    var
        Document: Record "CG X122 Document";
    begin
        Document.Get(No);
        exit(Format(Document.Status));
    end;

    local procedure AmountOf(No: Code[20]): Decimal
    var
        Document: Record "CG X122 Document";
    begin
        Document.Get(No);
        exit(Document.Amount);
    end;

    local procedure LogCountOf(KindValue: Code[20]): Integer
    var
        Log: Record "CG X122 Activity Log";
    begin
        Log.SetRange(Kind, KindValue);
        exit(Log.Count());
    end;

    local procedure LogDocNoOf(KindValue: Code[20]): Code[20]
    var
        Log: Record "CG X122 Activity Log";
    begin
        Log.SetRange(Kind, KindValue);
        if Log.FindFirst() then
            exit(Log."Doc No.");
        exit('');
    end;

    [Test]
    procedure BatchReleasesValidOpenDocuments()
    var
        Runner: Codeunit "CG X122 Release Batch Runner";
    begin
        ResetAll();
        SeedOpenDocument('D1', 500);
        SeedOpenDocument('D2', 250);

        Runner.RunReleaseBatch();

        Assert.AreEqual('Released', StatusOf('D1'), 'D1 must end up released');
        Assert.AreEqual('Released', StatusOf('D2'), 'D2 must end up released');
        Assert.AreEqual(2, LogCountOf('RELEASED'), 'Both released documents must leave a released activity entry');
        Assert.AreEqual(0, LogCountOf('CANCELLED'), 'A batch releasing only valid documents must leave no cancellation activity entries');
    end;

    [Test]
    procedure BatchDoesNotAlertForItsOwnAutoCancellation()
    var
        Runner: Codeunit "CG X122 Release Batch Runner";
        Spy: Codeunit "CG-AL-X122 Cancel Spy";
        Bound: Boolean;
        Unbound: Boolean;
    begin
        ResetAll();
        SeedOpenDocument('D1', 500); // valid
        SeedOpenDocument('D2', -10); // invalid amount

        // The spy is bound independently of whatever the application itself
        // does, so it still reports the batch's own cancellation even if a
        // rewrite routes around the application's usual notification path
        // for it.
        Bound := BindSubscription(Spy);
        Runner.RunReleaseBatch();
        Unbound := UnbindSubscription(Spy);

        Assert.AreEqual('Released', StatusOf('D1'), 'The valid document must still be released');
        Assert.AreEqual('Cancelled', StatusOf('D2'), 'The invalid document must still be cancelled by the batch''s own cleanup');
        Assert.AreEqual(1, LogCountOf('RELEASED'), 'Exactly one released activity entry is expected, for D1');
        Assert.AreEqual(0, LogCountOf('CANCELLED'),
            'The nightly batch must not leave a cancellation activity entry behind for a document it cancels as part of its own run');
        Assert.AreEqual(1, Spy.CancelCount(), 'The batch''s own cancellation of the invalid document must still be reported');
    end;

    [Test]
    procedure BatchWithOnlyInvalidDocumentsNeverAlerts()
    var
        Runner: Codeunit "CG X122 Release Batch Runner";
    begin
        ResetAll();
        SeedOpenDocument('D3', -5);
        SeedOpenDocument('D4', -8);

        Runner.RunReleaseBatch();

        Assert.AreEqual('Cancelled', StatusOf('D3'), 'D3 must be cancelled by the batch');
        Assert.AreEqual('Cancelled', StatusOf('D4'), 'D4 must be cancelled by the batch');
        Assert.AreEqual(0, LogCountOf('RELEASED'), 'Nothing was released, so no released activity entry is expected');
        Assert.AreEqual(0, LogCountOf('CANCELLED'),
            'None of the batch''s own cancellations may leave a cancellation activity entry behind, however many it cancels');
    end;

    [Test]
    procedure ManualCancelActionStillCreatesAnAlert()
    var
        CancelAction: Codeunit "CG X122 Cancel Action";
    begin
        ResetAll();
        SeedOpenDocument('D5', 500);

        CancelAction.CancelWithAlert('D5');

        Assert.AreEqual('Cancelled', StatusOf('D5'), 'D5 must end up cancelled');
        Assert.AreEqual(1, LogCountOf('CANCELLED'), 'A manual cancellation must still leave exactly one cancellation activity entry');
        Assert.AreEqual('D5', LogDocNoOf('CANCELLED'), 'The cancellation activity entry must name the document that was actually cancelled');
    end;

    [Test]
    procedure ManualCancelOfANegativeAmountDocumentStillCreatesAnAlert()
    var
        CancelAction: Codeunit "CG X122 Cancel Action";
    begin
        ResetAll();
        SeedOpenDocument('D15', -50); // negative amount, cancelled through the manual action, not the batch

        CancelAction.CancelWithAlert('D15');

        Assert.AreEqual('Cancelled', StatusOf('D15'), 'D15 must end up cancelled');
        Assert.AreEqual(1, LogCountOf('CANCELLED'),
            'A manual cancellation must still leave exactly one cancellation activity entry, whatever amount the document carries');
        Assert.AreEqual('D15', LogDocNoOf('CANCELLED'), 'The cancellation activity entry must name the document that was actually cancelled');
        Assert.AreEqual(0, LogCountOf('RELEASED'), 'A manual cancellation must not leave a released activity entry');
    end;

    [Test]
    procedure ManualCancelAlertSurvivesAfterABatchRun()
    var
        Runner: Codeunit "CG X122 Release Batch Runner";
        CancelAction: Codeunit "CG X122 Cancel Action";
    begin
        ResetAll();
        SeedOpenDocument('D6', 500); // valid - released by the batch
        SeedOpenDocument('D7', -20); // invalid - cancelled by the batch
        SeedOpenDocument('D8', 500); // cancelled manually afterward

        Runner.RunReleaseBatch();
        Assert.AreEqual(0, LogCountOf('CANCELLED'), 'The batch run itself must leave no cancellation activity entry behind');

        CancelAction.CancelWithAlert('D8');

        Assert.AreEqual('Cancelled', StatusOf('D8'), 'D8 must end up cancelled');
        Assert.AreEqual(1, LogCountOf('CANCELLED'),
            'After the batch run, a later manual cancellation must still create exactly one cancellation activity entry');
        Assert.AreEqual('D8', LogDocNoOf('CANCELLED'),
            'The cancellation activity entry must name the manually cancelled document, not one the batch cancelled');
    end;

    [Test]
    procedure AmountOfExactlyZeroIsTreatedAsValid()
    var
        Runner: Codeunit "CG X122 Release Batch Runner";
    begin
        ResetAll();
        SeedOpenDocument('D9', 0); // boundary amount

        Runner.RunReleaseBatch();

        Assert.AreEqual('Released', StatusOf('D9'), 'A document with an amount of exactly zero must be released, not cancelled');
        Assert.AreEqual(1, LogCountOf('RELEASED'), 'A zero-amount document must leave a released activity entry');
        Assert.AreEqual(0, LogCountOf('CANCELLED'), 'A zero-amount document must not leave a cancellation activity entry');
    end;

    [Test]
    procedure AmountJustBelowZeroIsTreatedAsInvalid()
    var
        Runner: Codeunit "CG X122 Release Batch Runner";
    begin
        ResetAll();
        SeedOpenDocument('D10', -0.01); // one cent below the boundary

        Runner.RunReleaseBatch();

        Assert.AreEqual('Cancelled', StatusOf('D10'), 'A document one cent below zero must be cancelled by the batch');
        Assert.AreEqual(0, LogCountOf('RELEASED'), 'Nothing was released');
        Assert.AreEqual(0, LogCountOf('CANCELLED'),
            'The batch cancelling a boundary-invalid document as part of its own run must still leave no cancellation activity entry behind');
    end;

    [Test]
    procedure AlreadyDecidedDocumentsAreLeftAloneByTheBatch()
    var
        Runner: Codeunit "CG X122 Release Batch Runner";
    begin
        ResetAll();
        SeedReleasedDocument('D11', 999); // already decided - sentinel amount
        SeedCancelledDocument('D12', 777); // already decided - sentinel amount
        SeedOpenDocument('D13', 300); // the only one the batch should touch

        Runner.RunReleaseBatch();

        Assert.AreEqual('Released', StatusOf('D11'), 'An already-released document must stay released');
        Assert.AreEqual(999, AmountOf('D11'), 'An already-released document''s amount must stay untouched');
        Assert.AreEqual('Cancelled', StatusOf('D12'), 'An already-cancelled document must stay cancelled');
        Assert.AreEqual(777, AmountOf('D12'), 'An already-cancelled document''s amount must stay untouched');
        Assert.AreEqual('Released', StatusOf('D13'), 'The one open document must be released');
        Assert.AreEqual(1, LogCountOf('RELEASED'),
            'Only the newly released document may leave a released activity entry - the already-decided ones must not be re-logged');
        Assert.AreEqual('D13', LogDocNoOf('RELEASED'), 'The released activity entry must name the document that was actually released');
        Assert.AreEqual(0, LogCountOf('CANCELLED'), 'Nothing was cancelled by this run, so no cancellation activity entry is expected');
    end;

    [Test]
    procedure DirectProcessorCallLeavesNoActivityEntry()
    var
        Processor: Codeunit "CG X122 Document Processor";
    begin
        ResetAll();
        SeedOpenDocument('D14', 500);

        Processor.ReleaseDocument('D14');

        Assert.AreEqual('Released', StatusOf('D14'), 'Calling the processor directly must still release the document');
        Assert.AreEqual(0, LogCountOf('RELEASED'), 'Releasing a document directly must not leave an activity entry');
    end;
}
