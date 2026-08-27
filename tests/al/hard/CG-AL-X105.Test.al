codeunit 89299 "CG-AL-X105 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods, so
    // every test clears the table before seeding its own rows.

    local procedure Seed(EntryNo: Integer; ApproverID: Code[20]; EntryStatus: Enum "CG X105 Approval Status"; AmountLimit: Integer)
    var
        Entry: Record "CG X105 Approval Entry";
    begin
        Entry.Init();
        Entry."Entry No." := EntryNo;
        Entry."Approver ID" := ApproverID;
        Entry.Status := EntryStatus;
        Entry."Amount Limit" := AmountLimit;
        Entry.Insert();
    end;

    [Test]
    procedure ApprovedEntrySurvivesAnOlderRejectedEntry()
    var
        Entry: Record "CG X105 Approval Entry";
        ApprovalLookup: Codeunit "CG X105 Approval Lookup";
    begin
        Entry.DeleteAll();
        Seed(1, 'APP1', Entry.Status::Rejected, 100);
        Seed(2, 'APP1', Entry.Status::Approved, 5000);

        Assert.IsTrue(ApprovalLookup.GetApprovalLimit('APP1', Entry), 'An approver with an approved entry must be found');
        Assert.AreEqual(Entry.Status::Approved, Entry.Status, 'The returned entry must be the approved one, not the rejected one');
        Assert.AreEqual(5000, Entry."Amount Limit", 'The returned entry must carry the approved limit, not the rejected one');

        Entry.Reset();
        Assert.AreEqual(2, Entry.Count(), 'Looking up an approver must not change the recorded approval history');
    end;

    [Test]
    procedure GuardAuthorizesUpToTheApprovedLimit()
    var
        Entry: Record "CG X105 Approval Entry";
        Guard: Codeunit "CG X105 Spend Guard";
    begin
        Entry.DeleteAll();
        Seed(10, 'APP1', Entry.Status::Rejected, 100);
        Seed(11, 'APP1', Entry.Status::Approved, 5000);

        Assert.IsTrue(Guard.IsWithinLimit('APP1', 5000), 'A request at the approved limit must be authorized');
        Assert.IsFalse(Guard.IsWithinLimit('APP1', 5001), 'A request over the approved limit must be denied');
    end;

    [Test]
    procedure SingleApprovedEntryIsFoundDirectly()
    var
        Entry: Record "CG X105 Approval Entry";
        ApprovalLookup: Codeunit "CG X105 Approval Lookup";
    begin
        Entry.DeleteAll();
        Seed(20, 'APP2', Entry.Status::Approved, 3000);

        Assert.IsTrue(ApprovalLookup.GetApprovalLimit('APP2', Entry), 'An approver with only an approved entry must be found');
        Assert.AreEqual(3000, Entry."Amount Limit", 'The only entry on file must be returned as-is');
    end;

    [Test]
    procedure PendingOnlyApproverHasNoApprovedLimit()
    var
        Entry: Record "CG X105 Approval Entry";
        ApprovalLookup: Codeunit "CG X105 Approval Lookup";
        Guard: Codeunit "CG X105 Spend Guard";
    begin
        Entry.DeleteAll();
        Seed(30, 'APP5', Entry.Status::Pending, 9999);

        Assert.IsFalse(ApprovalLookup.GetApprovalLimit('APP5', Entry), 'An approver with only a pending entry has no approved limit');
        Assert.IsFalse(Guard.IsWithinLimit('APP5', 1), 'A pending-only approver must not authorize any request');
    end;

    [Test]
    procedure UnrelatedApproversAreNotMixedUp()
    var
        Entry: Record "CG X105 Approval Entry";
        ApprovalLookup: Codeunit "CG X105 Approval Lookup";
    begin
        Entry.DeleteAll();
        Seed(40, 'APP1', Entry.Status::Rejected, 100);
        Seed(41, 'APP1', Entry.Status::Approved, 5000);
        Seed(42, 'APP3', Entry.Status::Rejected, 777);
        Seed(43, 'APP6', Entry.Status::Approved, 4200);

        Assert.IsFalse(ApprovalLookup.GetApprovalLimit('APP3', Entry), 'APP3 has no approved entry of its own and must not pick up another approver''s');
        Assert.IsTrue(ApprovalLookup.GetApprovalLimit('APP6', Entry), 'APP6 has its own approved entry and must be found');
        Assert.AreEqual(4200, Entry."Amount Limit", 'APP6''s own limit must be returned, not another approver''s');
    end;

    [Test]
    procedure ApprovedEntryIsFoundWhateverTheCallerWasViewing()
    var
        Entry: Record "CG X105 Approval Entry";
        ApprovalLookup: Codeunit "CG X105 Approval Lookup";
    begin
        Entry.DeleteAll();
        Seed(50, 'APP7', Entry.Status::Rejected, 111);
        Seed(51, 'APP7', Entry.Status::Approved, 7700);

        // The caller arrives holding a narrowed view of its own record that
        // excludes the approved entry. A lookup answers a question about the
        // approver, so what the caller happened to be looking at beforehand
        // must not change the answer.
        Entry.SetRange("Entry No.", 50, 50);

        Assert.IsTrue(ApprovalLookup.GetApprovalLimit('APP7', Entry), 'APP7 has its own approved entry and must be found however the caller''s record was set up beforehand');
        Assert.AreEqual(7700, Entry."Amount Limit", 'The approved limit must be returned even though the caller''s own filter excluded that row');
    end;
}
