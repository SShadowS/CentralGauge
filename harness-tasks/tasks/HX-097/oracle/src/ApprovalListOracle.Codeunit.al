codeunit 87400 "HX097 Approval List Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    // Scenario N uses users and owners 'HX097-UN-*' and approval entries 97000 + 100 * N + 1..99; the
    // subscriber adds the marker row Entry No. 9799900 + N (Table ID 0).

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure Scenario01()
    var
        ApprovalFilter: Record "CGR Approval Entry";
        Result: Record "CGR Approval Entry" temporary;
        Approvals: Codeunit "CGR Rental Approvals";
        Spy: Codeunit "HX097 List Spy";
        Expected: List of [Integer];
    begin
        HX097Begin(1, false, false);
        HX097Entry(97101, 70201, 'HX097-U1-ME', "CGR Approval Status"::Open);
        HX097Entry(97102, 70202, 'HX097-U1-ME', "CGR Approval Status"::Open);
        HX097Share('HX097-U1-O1', 'HX097-U1-ME', "CGR Sharing Type"::Colleague);
        HX097Share('HX097-U1-O1', 'HX097-U1-ME', "CGR Sharing Type"::"Out of Office");
        HX097Entry(97103, 70201, 'HX097-U1-O1', "CGR Approval Status"::Open);
        Spy.HX097SetMarker(9799901);
        BindSubscription(Spy);

        Approvals.BuildApprovalList(ApprovalFilter, 'HX097-U1-ME', Result);

        UnbindSubscription(Spy);
        Expected.Add(97101);
        Expected.Add(97102);
        Expected.Add(9799901);
        HX097AssertList(Result, Expected, 'S1');
        Assert.AreEqual(1, Spy.HX097Calls(), 'S1: OnAfterBuildApprovalList is raised once');
        HX097End(1);
    end;

    [Test]
    procedure Scenario02()
    var
        ApprovalFilter: Record "CGR Approval Entry";
        Result: Record "CGR Approval Entry" temporary;
        Approvals: Codeunit "CGR Rental Approvals";
        Spy: Codeunit "HX097 List Spy";
        Expected: List of [Integer];
    begin
        HX097Begin(2, true, false);
        HX097Entry(97201, 70201, 'HX097-U2-ME', "CGR Approval Status"::Open);
        HX097Entry(97202, 70202, 'HX097-U2-ME', "CGR Approval Status"::Open);
        HX097Share('HX097-U2-O1', 'HX097-U2-ME', "CGR Sharing Type"::Colleague);
        HX097Entry(97203, 70201, 'HX097-U2-O1', "CGR Approval Status"::Open);
        Spy.HX097SetMarker(9799902);
        BindSubscription(Spy);

        Approvals.BuildApprovalList(ApprovalFilter, 'HX097-U2-ME', Result);

        UnbindSubscription(Spy);
        Expected.Add(97201);
        Expected.Add(97202);
        Expected.Add(97203);
        Expected.Add(9799902);
        HX097AssertList(Result, Expected, 'S2');
        HX097AssertCopy(Result, 97203, 'S2');
        Assert.AreEqual(1, Spy.HX097Calls(), 'S2: OnAfterBuildApprovalList is raised once');
        HX097End(2);
    end;

    [Test]
    procedure Scenario03()
    var
        ApprovalFilter: Record "CGR Approval Entry";
        Result: Record "CGR Approval Entry" temporary;
        Approvals: Codeunit "CGR Rental Approvals";
        Spy: Codeunit "HX097 List Spy";
        Expected: List of [Integer];
    begin
        HX097Begin(3, true, false);
        HX097Entry(97301, 70201, 'HX097-U3-ME', "CGR Approval Status"::Open);
        HX097Entry(97302, 70202, 'HX097-U3-ME', "CGR Approval Status"::Open);
        HX097Share('HX097-U3-O1', 'HX097-U3-ME', "CGR Sharing Type"::Colleague);
        HX097Entry(97303, 70201, 'HX097-U3-O1', "CGR Approval Status"::Open);
        HX097Entry(97304, 70202, 'HX097-U3-O1', "CGR Approval Status"::Open);
        Spy.HX097SetMarker(9799903);
        BindSubscription(Spy);

        ApprovalFilter.SetRange("Table ID", 70201);
        Approvals.BuildApprovalList(ApprovalFilter, 'HX097-U3-ME', Result);

        UnbindSubscription(Spy);
        Expected.Add(97301);
        Expected.Add(97303);
        Expected.Add(9799903);
        HX097AssertList(Result, Expected, 'S3');
        Assert.AreEqual(1, Spy.HX097Calls(), 'S3: OnAfterBuildApprovalList is raised once');
        HX097End(3);
    end;

    [Test]
    procedure Scenario04()
    var
        ApprovalFilter: Record "CGR Approval Entry";
        Result: Record "CGR Approval Entry" temporary;
        Approvals: Codeunit "CGR Rental Approvals";
        Spy: Codeunit "HX097 List Spy";
        Expected: List of [Integer];
    begin
        HX097Begin(4, true, false);
        HX097Entry(97401, 70201, 'HX097-U4-ME', "CGR Approval Status"::Open);
        HX097Share('HX097-U4-O1', 'HX097-U4-ME', "CGR Sharing Type"::Colleague);
        HX097Entry(97402, 70201, 'HX097-U4-O1', "CGR Approval Status"::Open);
        HX097Entry(97403, 70201, 'HX097-U4-O1', "CGR Approval Status"::Approved);
        HX097Entry(97404, 70202, 'HX097-U4-O1', "CGR Approval Status"::Rejected);
        Spy.HX097SetMarker(9799904);
        BindSubscription(Spy);

        Approvals.BuildApprovalList(ApprovalFilter, 'HX097-U4-ME', Result);

        UnbindSubscription(Spy);
        Expected.Add(97401);
        Expected.Add(97402);
        Expected.Add(9799904);
        HX097AssertList(Result, Expected, 'S4');
        Assert.AreEqual(1, Spy.HX097Calls(), 'S4: OnAfterBuildApprovalList is raised once');
        HX097End(4);
    end;

    [Test]
    procedure Scenario05()
    var
        ApprovalFilter: Record "CGR Approval Entry";
        Result: Record "CGR Approval Entry" temporary;
        Approvals: Codeunit "CGR Rental Approvals";
        Spy: Codeunit "HX097 List Spy";
        Expected: List of [Integer];
    begin
        HX097Begin(5, false, true);
        HX097Entry(97501, 70201, 'HX097-U5-ME', "CGR Approval Status"::Open);
        HX097Share('HX097-U5-O1', 'HX097-U5-ME', "CGR Sharing Type"::"Out of Office");
        HX097Entry(97502, 70201, 'HX097-U5-O1', "CGR Approval Status"::Open);
        HX097Share('HX097-U5-O2', 'HX097-U5-ME', "CGR Sharing Type"::Colleague);
        HX097Entry(97503, 70201, 'HX097-U5-O2', "CGR Approval Status"::Open);
        Spy.HX097SetMarker(9799905);
        BindSubscription(Spy);

        Approvals.BuildApprovalList(ApprovalFilter, 'HX097-U5-ME', Result);

        UnbindSubscription(Spy);
        Expected.Add(97501);
        Expected.Add(97502);
        Expected.Add(9799905);
        HX097AssertList(Result, Expected, 'S5');
        Assert.AreEqual(1, Spy.HX097Calls(), 'S5: OnAfterBuildApprovalList is raised once');
        HX097End(5);
    end;

    [Test]
    procedure Scenario06()
    var
        ApprovalFilter: Record "CGR Approval Entry";
        Result: Record "CGR Approval Entry" temporary;
        Approvals: Codeunit "CGR Rental Approvals";
        Spy: Codeunit "HX097 List Spy";
        Expected: List of [Integer];
    begin
        HX097Begin(6, true, false);
        HX097Entry(97601, 70201, 'HX097-U6-ME', "CGR Approval Status"::Open);
        HX097Share('HX097-U6-O1', 'HX097-U6-OTHER', "CGR Sharing Type"::Colleague);
        HX097Entry(97602, 70201, 'HX097-U6-O1', "CGR Approval Status"::Open);
        Spy.HX097SetMarker(9799906);
        BindSubscription(Spy);

        Approvals.BuildApprovalList(ApprovalFilter, 'HX097-U6-ME', Result);

        UnbindSubscription(Spy);
        Expected.Add(97601);
        Expected.Add(9799906);
        HX097AssertList(Result, Expected, 'S6');
        Assert.AreEqual(1, Spy.HX097Calls(), 'S6: OnAfterBuildApprovalList is raised once');
        HX097End(6);
    end;

    [Test]
    procedure Scenario07()
    var
        ApprovalEntry: Record "CGR Approval Entry";
        Result: Record "CGR Approval Entry" temporary;
        Approvals: Codeunit "CGR Rental Approvals";
        Spy: Codeunit "HX097 List Spy";
        Expected: List of [Integer];
    begin
        HX097Begin(7, true, false);
        HX097Share('HX097-U7-O1', 'HX097-U7-ME', "CGR Sharing Type"::Colleague);
        HX097Entry(97701, 70201, 'HX097-U7-O1', "CGR Approval Status"::Open);
        HX097Entry(97702, 70202, 'HX097-U7-O1', "CGR Approval Status"::Open);
        HX097Entry(97703, 70201, 'HX097-U7-O1', "CGR Approval Status"::Approved);
        HX097Entry(97704, 70201, 'HX097-U7-ME', "CGR Approval Status"::Open);
        HX097Entry(97705, 70201, 'HX097-U7-O2', "CGR Approval Status"::Open);
        HX097Entry(97706, 70201, 'HX097-U7-O1', "CGR Approval Status"::Open);
        Spy.HX097SetMarker(9799907);
        BindSubscription(Spy);

        ApprovalEntry.SetRange("Table ID", 70201);
        ApprovalEntry.SetRange(Status, ApprovalEntry.Status::Open);
        ApprovalEntry.FilterGroup(2);
        ApprovalEntry.SetRange("Document No.", HX097DocNo(97701));
        ApprovalEntry.FilterGroup(0);
        Approvals.AddSharedApprovals(ApprovalEntry, 'HX097-U7-ME', Result);

        UnbindSubscription(Spy);
        Expected.Add(97701);
        HX097AssertList(Result, Expected, 'S7');
        HX097AssertCopy(Result, 97701, 'S7');
        Assert.AreEqual(0, Spy.HX097Calls(), 'S7: AddSharedApprovals does not raise OnAfterBuildApprovalList');
        HX097End(7);
    end;

    [Test]
    procedure Scenario08()
    var
        ApprovalEntry: Record "CGR Approval Entry";
        Result: Record "CGR Approval Entry" temporary;
        Approvals: Codeunit "CGR Rental Approvals";
        Spy: Codeunit "HX097 List Spy";
        Expected: List of [Integer];
    begin
        HX097Begin(8, false, false);
        HX097Share('HX097-U8-O1', 'HX097-U8-ME', "CGR Sharing Type"::Colleague);
        HX097Share('HX097-U8-O1', 'HX097-U8-ME', "CGR Sharing Type"::"Out of Office");
        HX097Entry(97801, 70201, 'HX097-U8-O1', "CGR Approval Status"::Open);
        Spy.HX097SetMarker(9799908);
        BindSubscription(Spy);

        ApprovalEntry.SetRange(Status, ApprovalEntry.Status::Open);
        Approvals.AddSharedApprovals(ApprovalEntry, 'HX097-U8-ME', Result);

        UnbindSubscription(Spy);
        HX097AssertList(Result, Expected, 'S8');
        Assert.AreEqual(0, Spy.HX097Calls(), 'S8: AddSharedApprovals does not raise OnAfterBuildApprovalList');
        HX097End(8);
    end;

    [Test]
    procedure Scenario09()
    var
        ApprovalFilter: Record "CGR Approval Entry";
        Result: Record "CGR Approval Entry" temporary;
        Approvals: Codeunit "CGR Rental Approvals";
        Spy: Codeunit "HX097 List Spy";
        Expected: List of [Integer];
    begin
        HX097Begin(9, true, false);
        HX097Entry(97901, 70201, 'HX097-U9-ME', "CGR Approval Status"::Open);
        HX097Entry(97902, 70202, 'HX097-U9-ME', "CGR Approval Status"::Open);
        Spy.HX097SetMarker(9799909);
        BindSubscription(Spy);

        Approvals.BuildApprovalList(ApprovalFilter, 'HX097-U9-ME', Result);

        UnbindSubscription(Spy);
        Expected.Add(97901);
        Expected.Add(97902);
        Expected.Add(9799909);
        HX097AssertList(Result, Expected, 'S9');
        Assert.AreEqual(1, Spy.HX097Calls(), 'S9: OnAfterBuildApprovalList is raised once');
        HX097End(9);
    end;

    [Test]
    procedure Scenario10()
    var
        ApprovalFilter: Record "CGR Approval Entry";
        Result: Record "CGR Approval Entry" temporary;
        Approvals: Codeunit "CGR Rental Approvals";
        Spy: Codeunit "HX097 List Spy";
        Expected: List of [Integer];
    begin
        HX097Begin(10, true, true);
        HX097Entry(98001, 70201, 'HX097-U10-ME', "CGR Approval Status"::Open);
        HX097Share('HX097-U10-O1', 'HX097-U10-ME', "CGR Sharing Type"::Colleague);
        HX097Share('HX097-U10-O1', 'HX097-U10-ME', "CGR Sharing Type"::"Out of Office");
        HX097Entry(98002, 70201, 'HX097-U10-O1', "CGR Approval Status"::Open);
        HX097Entry(98003, 70202, 'HX097-U10-O1', "CGR Approval Status"::Open);
        Spy.HX097SetMarker(9799910);
        BindSubscription(Spy);

        Approvals.BuildApprovalList(ApprovalFilter, 'HX097-U10-ME', Result);

        UnbindSubscription(Spy);
        Expected.Add(98001);
        Expected.Add(98002);
        Expected.Add(98003);
        Expected.Add(9799910);
        HX097AssertList(Result, Expected, 'S10');
        Assert.AreEqual(1, Spy.HX097Calls(), 'S10: OnAfterBuildApprovalList is raised once');
        HX097End(10);
    end;

    local procedure HX097Begin(Scenario: Integer; ShareWithColleagues: Boolean; ShareOutOfOffice: Boolean)
    var
        SessionContext: Codeunit "CGR Session Context";
    begin
        HX097DeleteRows(Scenario);
        HX097SetFlags(ShareWithColleagues, ShareOutOfOffice);
        SessionContext.Reset();
    end;

    local procedure HX097End(Scenario: Integer)
    var
        SessionContext: Codeunit "CGR Session Context";
    begin
        HX097DeleteRows(Scenario);
        HX097SetFlags(false, false);
        SessionContext.Reset();
    end;

    local procedure HX097SetFlags(ShareWithColleagues: Boolean; ShareOutOfOffice: Boolean)
    var
        Setup: Record "CGR Setup";
    begin
        Setup.GetOrCreate();
        Setup."Share Approvals with Colleagues" := ShareWithColleagues;
        Setup."Share Approvals Out of Office" := ShareOutOfOffice;
        Setup.Modify();
    end;

    local procedure HX097DeleteRows(Scenario: Integer)
    var
        Entry: Record "CGR Approval Entry";
        Sharing: Record "CGR Approval Sharing";
    begin
        Entry.SetRange("Entry No.", 97000 + Scenario * 100, 97099 + Scenario * 100);
        Entry.DeleteAll();
        Sharing.SetFilter("Owner ID", StrSubstNo('HX097-U%1-*', Scenario));
        Sharing.DeleteAll();
    end;

    local procedure HX097Entry(EntryNo: Integer; TableID: Integer; ApproverID: Code[50]; Status: Enum "CGR Approval Status")
    var
        Entry: Record "CGR Approval Entry";
    begin
        Entry.Init();
        Entry."Entry No." := EntryNo;
        Entry."Table ID" := TableID;
        Entry."Document No." := HX097DocNo(EntryNo);
        Entry."Approver ID" := ApproverID;
        Entry.Status := Status;
        Entry.Insert();
    end;

    local procedure HX097Share(OwnerID: Code[50]; SharedWithID: Code[50]; SharingType: Enum "CGR Sharing Type")
    var
        Sharing: Record "CGR Approval Sharing";
    begin
        Sharing.Init();
        Sharing."Owner ID" := OwnerID;
        Sharing."Shared With ID" := SharedWithID;
        Sharing."Sharing Type" := SharingType;
        Sharing.Insert();
    end;

    local procedure HX097DocNo(EntryNo: Integer): Code[20]
    begin
        exit(CopyStr('HX097-' + Format(EntryNo, 0, 9), 1, 20));
    end;

    local procedure HX097AssertCopy(var Result: Record "CGR Approval Entry" temporary; EntryNo: Integer; Scenario: Text)
    var
        Source: Record "CGR Approval Entry";
    begin
        Source.Get(EntryNo);
        Result.Reset();
        Assert.IsTrue(Result.Get(EntryNo), StrSubstNo('%1: entry %2 is in the approval list', Scenario, EntryNo));
        Assert.AreEqual(Source."Table ID", Result."Table ID", StrSubstNo('%1: Table ID of entry %2', Scenario, EntryNo));
        Assert.AreEqual(Source."Document No.", Result."Document No.", StrSubstNo('%1: Document No. of entry %2', Scenario, EntryNo));
        Assert.AreEqual(Source."Approver ID", Result."Approver ID", StrSubstNo('%1: Approver ID of entry %2', Scenario, EntryNo));
        Assert.AreEqual(Source.Status, Result.Status, StrSubstNo('%1: Status of entry %2', Scenario, EntryNo));
    end;

    local procedure HX097AssertList(var Result: Record "CGR Approval Entry" temporary; Expected: List of [Integer]; Scenario: Text)
    var
        EntryNo: Integer;
    begin
        Result.Reset();
        Assert.AreEqual(Expected.Count(), Result.Count(), Scenario + ': number of rows in the approval list');
        foreach EntryNo in Expected do
            Assert.IsTrue(Result.Get(EntryNo), StrSubstNo('%1: entry %2 is in the approval list', Scenario, EntryNo));
    end;
}
