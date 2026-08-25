codeunit 89314 "CG-AL-X120 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods
    // (measured 2026-08-20, SOAP runner), so every test clears both tables
    // before seeding its own records.

    local procedure ClearAllData()
    var
        ApprovedRecord: Record "CG X120 Approved Record";
        Pending: Record "CG X120 Pending Verification";
    begin
        Pending.DeleteAll();
        ApprovedRecord.DeleteAll();
    end;

    [Test]
    procedure ChangingATrackedFieldPutsTheRecordOnThePendingList()
    var
        Reconciler: Codeunit "CG X120 Approval Reconciler";
        ApprovedRecord: Record "CG X120 Approved Record";
        Pending: Record "CG X120 Pending Verification";
    begin
        ClearAllData();
        Reconciler.InitializeRecord('ACME', 'Acme Corp', 1000);

        Reconciler.SetContactName('ACME', 'Acme Corporation');

        Assert.IsTrue(Reconciler.IsPending('ACME'),
            'Expected the record to appear on the pending list after a tracked field was changed away from its approved value');
        Assert.IsTrue(Reconciler.IsFieldPending('ACME', 'Contact Name'),
            'Expected the changed field itself to be flagged pending');
        Assert.AreEqual(1, Reconciler.PendingFieldCount('ACME'),
            'Expected exactly one field to be pending after a single field was changed');
        Assert.IsTrue(Pending.Get('ACME', 'Contact Name'),
            'Expected the change to be recorded directly in the pending-verification storage, not just reported through the codeunit');
        ApprovedRecord.Get('ACME');
        Assert.AreEqual('Acme Corporation', ApprovedRecord."Contact Name",
            'Expected the new contact name to be persisted on the record itself');
    end;

    [Test]
    procedure ARecordThatMatchesItsApprovedValuesAgainIsNotOnThePendingList()
    var
        Reconciler: Codeunit "CG X120 Approval Reconciler";
        Pending: Record "CG X120 Pending Verification";
    begin
        ClearAllData();
        Reconciler.InitializeRecord('ACME', 'Acme Corp', 1000);
        Reconciler.SetContactName('ACME', 'Acme Corporation');

        Reconciler.SetContactName('ACME', 'Acme Corp');

        Assert.IsFalse(Reconciler.IsPending('ACME'),
            'Expected the record to come off the pending list once the changed field matched its approved value again');
        Assert.AreEqual(0, Reconciler.PendingFieldCount('ACME'),
            'Expected no fields to remain pending once the only changed field matched its approved value again');
        Pending.SetRange("Record No.", 'ACME');
        Assert.IsTrue(Pending.IsEmpty(),
            'Expected no leftover entry to remain recorded for the record once every tracked field matched again');
    end;

    [Test]
    procedure ACreditLimitThatExactlyMatchesItsApprovedValueIsNotOnThePendingList()
    var
        Reconciler: Codeunit "CG X120 Approval Reconciler";
        ApprovedRecord: Record "CG X120 Approved Record";
    begin
        ClearAllData();
        Reconciler.InitializeRecord('ACME', 'Acme Corp', 1000);

        Reconciler.SetCreditLimit('ACME', 999.99);
        ApprovedRecord.Get('ACME');
        Assert.AreEqual(999.99, ApprovedRecord."Credit Limit",
            'Expected the new credit limit to be persisted on the record itself');
        Assert.IsTrue(Reconciler.IsFieldPending('ACME', 'Credit Limit'),
            'Expected the field to remain pending while its value is close to, but not exactly, its approved value');

        Reconciler.SetCreditLimit('ACME', 1000.01);
        Assert.IsTrue(Reconciler.IsFieldPending('ACME', 'Credit Limit'),
            'Expected the field to remain pending while its value is close to, but not exactly, its approved value');

        Reconciler.SetCreditLimit('ACME', 1000.001);
        Assert.IsTrue(Reconciler.IsFieldPending('ACME', 'Credit Limit'),
            'Expected the field to remain pending while its value differs from its approved value by even a small amount');

        Reconciler.SetCreditLimit('ACME', 1000);

        Assert.IsFalse(Reconciler.IsFieldPending('ACME', 'Credit Limit'),
            'Expected the field to come off the pending list only once it was set back to exactly its approved value');
        Assert.IsFalse(Reconciler.IsPending('ACME'),
            'Expected the record to come off the pending list once its only changed field matched its approved value exactly');
    end;

    [Test]
    procedure ARecordWithOneFieldStillDifferingRemainsOnThePendingList()
    var
        Reconciler: Codeunit "CG X120 Approval Reconciler";
    begin
        ClearAllData();
        Reconciler.InitializeRecord('ACME', 'Acme Corp', 1000);
        Reconciler.SetContactName('ACME', 'Acme Corporation');
        Reconciler.SetCreditLimit('ACME', 2000);

        Reconciler.SetContactName('ACME', 'Acme Corp');

        Assert.IsTrue(Reconciler.IsPending('ACME'),
            'Expected the record to remain on the pending list while one of its two changed fields still differs from its approved value');
        Assert.IsFalse(Reconciler.IsFieldPending('ACME', 'Contact Name'),
            'Expected the matched field to no longer be flagged pending on its own');
        Assert.IsTrue(Reconciler.IsFieldPending('ACME', 'Credit Limit'),
            'Expected the still-changed field to remain flagged pending');
        Assert.AreEqual(1, Reconciler.PendingFieldCount('ACME'),
            'Expected exactly one field to remain pending while only one of two changed fields matches its approved value');
    end;

    [Test]
    procedure ARecordWhoseFieldsAllMatchTheirApprovedValuesIsNotOnThePendingList()
    var
        Reconciler: Codeunit "CG X120 Approval Reconciler";
    begin
        ClearAllData();
        Reconciler.InitializeRecord('ACME', 'Acme Corp', 1000);
        Reconciler.SetContactName('ACME', 'Acme Corporation');
        Reconciler.SetCreditLimit('ACME', 2000);

        Reconciler.SetContactName('ACME', 'Acme Corp');
        Reconciler.SetCreditLimit('ACME', 1000);

        Assert.IsFalse(Reconciler.IsPending('ACME'),
            'Expected the record to come off the pending list once every changed field matched its approved value again');
        Assert.AreEqual(0, Reconciler.PendingFieldCount('ACME'),
            'Expected no fields to remain pending once both changed fields matched their approved values again');
    end;

    [Test]
    procedure ChangingAFieldAgainToADifferentValueStaysPendingWithoutDuplicating()
    var
        Reconciler: Codeunit "CG X120 Approval Reconciler";
    begin
        ClearAllData();
        Reconciler.InitializeRecord('ACME', 'Acme Corp', 1000);
        Reconciler.SetContactName('ACME', 'Acme Corporation');

        Reconciler.SetContactName('ACME', 'Acme Corp Ltd');

        Assert.IsTrue(Reconciler.IsFieldPending('ACME', 'Contact Name'),
            'Expected the field to remain pending after being changed a second time to another value that still differs from its approved value');
        Assert.AreEqual(1, Reconciler.PendingFieldCount('ACME'),
            'Expected changing an already-pending field again to leave exactly one pending entry, not create a second one');
    end;

    [Test]
    procedure AFieldThatDiffersAfterPreviouslyMatchingIsOnThePendingListAgain()
    var
        Reconciler: Codeunit "CG X120 Approval Reconciler";
    begin
        ClearAllData();
        Reconciler.InitializeRecord('ACME', 'Acme Corp', 1000);

        Reconciler.SetContactName('ACME', 'Acme Corporation');
        Assert.IsTrue(Reconciler.IsPending('ACME'),
            'Expected the record to be pending right after the field was first changed');

        Reconciler.SetContactName('ACME', 'Acme Corp');
        Assert.IsFalse(Reconciler.IsPending('ACME'),
            'Expected the record to come off the pending list once the field matched its approved value again');

        Reconciler.SetContactName('ACME', 'Acme Corp Revised');
        Assert.IsTrue(Reconciler.IsPending('ACME'),
            'Expected the record to go back on the pending list once the same field differed from its approved value again');
        Assert.AreEqual(1, Reconciler.PendingFieldCount('ACME'),
            'Expected exactly one pending field after a field differed, matched, and then differed again');
    end;

    [Test]
    procedure ApprovingCurrentValuesSnapshotsThemAsTheNewBaselineAndClearsPending()
    var
        Reconciler: Codeunit "CG X120 Approval Reconciler";
    begin
        ClearAllData();
        Reconciler.InitializeRecord('ACME', 'Acme Corp', 1000);
        Reconciler.SetContactName('ACME', 'New Name Inc');
        Reconciler.SetCreditLimit('ACME', 2000);

        Reconciler.InitializeRecord('GLOBEX', 'Globex Corp', 500);
        Reconciler.SetContactName('GLOBEX', 'Globex International');

        Reconciler.ApproveCurrentValues('ACME');

        Assert.IsFalse(Reconciler.IsPending('ACME'),
            'Expected approving the current values to clear every pending entry for that record');
        Assert.AreEqual(0, Reconciler.PendingFieldCount('ACME'),
            'Expected no fields to remain pending right after approval');
        Assert.IsTrue(Reconciler.IsPending('GLOBEX'),
            'Expected pending entries for an unrelated record to survive approving a different record');
        Assert.AreEqual(1, Reconciler.PendingFieldCount('GLOBEX'),
            'Expected an unrelated record to keep its own pending field count when a different record was approved');

        Reconciler.SetContactName('ACME', 'Acme Corp');

        Assert.IsTrue(Reconciler.IsFieldPending('ACME', 'Contact Name'),
            'Expected approval to move the approved value forward - setting the field back to its old value should now count as a change from the newly approved value');
    end;

    // AL compares Text with = / <> case-sensitively (confirmed by this
    // task's own discrimination probe, 2026-08-25, Cronus28).
    [Test]
    procedure AValueThatDiffersOnlyInLetterCaseIsStillOnThePendingList()
    var
        Reconciler: Codeunit "CG X120 Approval Reconciler";
    begin
        ClearAllData();
        Reconciler.InitializeRecord('ACME', 'Acme Corp', 1000);

        Reconciler.SetContactName('ACME', 'ACME CORP');

        Assert.IsTrue(Reconciler.IsFieldPending('ACME', 'Contact Name'),
            'Expected a value that differs only in letter case from the approved value to still count as a change');
        Assert.AreEqual(1, Reconciler.PendingFieldCount('ACME'),
            'Expected exactly one field pending for a case-different value');
    end;

    [Test]
    procedure CrossRecordIsolationPendingOnOneRecordDoesNotAffectAnother()
    var
        Reconciler: Codeunit "CG X120 Approval Reconciler";
        ApprovedRecord: Record "CG X120 Approved Record";
    begin
        ClearAllData();
        Reconciler.InitializeRecord('ACME', 'Acme Corp', 1000);
        Reconciler.InitializeRecord('GLOBEX', 'Globex Corp', 500);

        Reconciler.SetContactName('ACME', 'Acme Corporation');

        Assert.IsTrue(Reconciler.IsPending('ACME'),
            'Expected the edited record to be pending');
        Assert.IsFalse(Reconciler.IsPending('GLOBEX'),
            'Expected an unrelated record to stay off the pending list when a different record was changed');
        Assert.AreEqual(0, Reconciler.PendingFieldCount('GLOBEX'),
            'Expected an unrelated record to have no pending fields when a different record was changed');

        ApprovedRecord.Get('GLOBEX');
        Assert.AreEqual('Globex Corp', ApprovedRecord."Contact Name",
            'Expected the current contact name of an unrelated record to be untouched by editing a different record');
        Assert.AreEqual(500, ApprovedRecord."Credit Limit",
            'Expected the current credit limit of an unrelated record to be untouched by editing a different record');
        Assert.AreEqual('Globex Corp', ApprovedRecord."Approved Contact Name",
            'Expected the approved contact name of an unrelated record to be untouched by editing a different record');
        Assert.AreEqual(500, ApprovedRecord."Approved Credit Limit",
            'Expected the approved credit limit of an unrelated record to be untouched by editing a different record');
    end;

    [Test]
    procedure InitializingARecordStartsFullyApprovedAndNotPending()
    var
        Reconciler: Codeunit "CG X120 Approval Reconciler";
        ApprovedRecord: Record "CG X120 Approved Record";
    begin
        ClearAllData();

        Reconciler.InitializeRecord('ACME', 'Acme Corp', 1000);

        Assert.IsFalse(Reconciler.IsPending('ACME'),
            'Expected a freshly initialized record to have nothing pending');
        Assert.AreEqual(0, Reconciler.PendingFieldCount('ACME'),
            'Expected a freshly initialized record to have zero pending fields');
        ApprovedRecord.Get('ACME');
        Assert.AreEqual('Acme Corp', ApprovedRecord."Contact Name",
            'Expected the initialized record to store the given contact name as its current value');
        Assert.AreEqual(1000, ApprovedRecord."Credit Limit",
            'Expected the initialized record to store the given credit limit as its current value');
    end;

    [Test]
    procedure SettingAFieldToItsAlreadyApprovedValueIsANoOp()
    var
        Reconciler: Codeunit "CG X120 Approval Reconciler";
    begin
        ClearAllData();
        Reconciler.InitializeRecord('ACME', 'Acme Corp', 1000);

        Reconciler.SetContactName('ACME', 'Acme Corp');
        Reconciler.SetCreditLimit('ACME', 1000);

        Assert.IsFalse(Reconciler.IsPending('ACME'),
            'Expected setting fields to the values they were already approved at to leave nothing pending');
        Assert.AreEqual(0, Reconciler.PendingFieldCount('ACME'),
            'Expected zero pending fields after setting fields to their own already-approved values');
    end;
}
