codeunit 89384 "CG-AL-X164 Test"
{
    Subtype = Test;
    TestPermissions = Restrictive;

    var
        Assert: Codeunit Assert;
        LibraryLowerPermissions: Codeunit "Library - Lower Permissions";

    [Test]
    procedure FullRightsSubmissionSavesTheRequestAndRecordsAnAccurateUsageEntry()
    var
        Request: Record "CG X164 Request";
        Trace: Record "CG X164 Usage Trace";
        Mgt: Codeunit "CG X164 Request Mgt";
    begin
        LibraryLowerPermissions.PushPermissionSetWithoutDefaults('CG X164 Full');

        Request.DeleteAll();
        Trace.DeleteAll();

        Mgt.SubmitRequest('REQ-F001', 'Widget Restock', 250);

        Assert.IsTrue(Request.Get('REQ-F001'), 'A submitted request must be saved');
        Assert.AreEqual('Widget Restock', Request.Description, 'The saved request must carry the submitted description');
        Assert.AreEqual(250, Request.Amount, 'The saved request must carry the submitted amount');

        Trace.SetRange("Request No.", 'REQ-F001');
        Assert.IsTrue(Trace.FindFirst(), 'Submitting a request must record a usage entry for a fully privileged role');
        Assert.AreEqual('Widget Restock', Trace.Description, 'The usage entry must carry the request''s description');
        Assert.AreEqual(1, Mgt.CountTraces('REQ-F001'), 'Exactly one usage entry must exist for the request');
    end;

    [Test]
    procedure TheAuditRoleCanStillSubmitARequestWithoutItBeingBlocked()
    var
        Request: Record "CG X164 Request";
        Trace: Record "CG X164 Usage Trace";
        Mgt: Codeunit "CG X164 Request Mgt";
    begin
        LibraryLowerPermissions.PushPermissionSetWithoutDefaults('CG X164 Clerk');

        Request.DeleteAll();

        Mgt.SubmitRequest('REQ-C001', 'Quarterly Review', 75);

        Assert.IsTrue(Request.Get('REQ-C001'), 'A request submitted by the audit role must still be saved');
        Assert.AreEqual('Quarterly Review', Request.Description, 'The saved request must carry the submitted description');
        Assert.AreEqual(75, Request.Amount, 'The saved request must carry the submitted amount');

        Trace.SetRange("Request No.", 'REQ-C001');
        Assert.IsFalse(Trace.FindFirst(), 'The audit role must not produce a usage entry it cannot itself write');
        Assert.AreEqual(0, Mgt.CountTraces('REQ-C001'), 'No usage entry should exist for a request submitted by the audit role');
    end;

    [Test]
    procedure TheAuditRoleCanSubmitMultipleRequestsAllWithoutUsageEntries()
    var
        Request: Record "CG X164 Request";
        Mgt: Codeunit "CG X164 Request Mgt";
    begin
        LibraryLowerPermissions.PushPermissionSetWithoutDefaults('CG X164 Clerk');

        Request.DeleteAll();

        Mgt.SubmitRequest('REQ-C010', 'Facilities Ticket', 40);
        Mgt.SubmitRequest('REQ-C011', 'Travel Approval', 500);

        Assert.IsTrue(Request.Get('REQ-C010'), 'Every request submitted by the audit role must be saved');
        Assert.IsTrue(Request.Get('REQ-C011'), 'Every request submitted by the audit role must be saved');
        Assert.AreEqual(0, Mgt.CountTraces('REQ-C010'), 'No usage entry should exist for a request submitted by the audit role');
        Assert.AreEqual(0, Mgt.CountTraces('REQ-C011'), 'No usage entry should exist for a request submitted by the audit role');
    end;

    [Test]
    procedure TheAuditRoleCanInspectUsageDataWithoutError()
    var
        Request: Record "CG X164 Request";
        Trace: Record "CG X164 Usage Trace";
        Mgt: Codeunit "CG X164 Request Mgt";
    begin
        LibraryLowerPermissions.PushPermissionSetWithoutDefaults('CG X164 Clerk');

        Request.DeleteAll();

        Trace.SetRange("Request No.", 'REQ-NEVER-SUBMITTED');
        Assert.IsFalse(Trace.FindFirst(), 'The audit role must be able to look at usage data without error');
        Assert.AreEqual(0, Mgt.CountTraces('REQ-NEVER-SUBMITTED'), 'The audit role must be able to count usage entries without error');
    end;

    [Test]
    procedure ASubmissionWithANonPositiveAmountIsRejectedUnderFullRights()
    var
        Request: Record "CG X164 Request";
        Mgt: Codeunit "CG X164 Request Mgt";
    begin
        LibraryLowerPermissions.PushPermissionSetWithoutDefaults('CG X164 Full');

        Request.DeleteAll();

        asserterror Mgt.SubmitRequest('REQ-V001', 'Zero Amount', 0);

        Assert.IsFalse(Request.Get('REQ-V001'), 'A request with a non-positive amount must not be saved');
    end;

    [Test]
    procedure ASubmissionWithANonPositiveAmountIsRejectedForTheAuditRole()
    var
        Request: Record "CG X164 Request";
        Mgt: Codeunit "CG X164 Request Mgt";
    begin
        LibraryLowerPermissions.PushPermissionSetWithoutDefaults('CG X164 Clerk');

        Request.DeleteAll();

        asserterror Mgt.SubmitRequest('REQ-V010', 'Negative Amount', -50);

        Assert.IsFalse(Request.Get('REQ-V010'), 'A request with a non-positive amount must not be saved regardless of role');
    end;

    [Test]
    procedure TwoIndependentFullRightsSubmissionsProduceIndependentUsageEntries()
    var
        Request: Record "CG X164 Request";
        Trace: Record "CG X164 Usage Trace";
        Mgt: Codeunit "CG X164 Request Mgt";
    begin
        LibraryLowerPermissions.PushPermissionSetWithoutDefaults('CG X164 Full');

        Request.DeleteAll();
        Trace.DeleteAll();

        Mgt.SubmitRequest('REQ-I001', 'Alpha Purchase', 300);
        Mgt.SubmitRequest('REQ-I002', 'Beta Purchase', 150);

        Trace.SetRange("Request No.", 'REQ-I001');
        Assert.IsTrue(Trace.FindFirst(), 'Each submitted request must have its own usage entry');
        Assert.AreEqual('Alpha Purchase', Trace.Description, 'Each usage entry must carry its own request''s description');

        Trace.SetRange("Request No.", 'REQ-I002');
        Assert.IsTrue(Trace.FindFirst(), 'Each submitted request must have its own usage entry');
        Assert.AreEqual('Beta Purchase', Trace.Description, 'Each usage entry must carry its own request''s description');

        Assert.AreEqual(1, Mgt.CountTraces('REQ-I001'), 'Usage entries for one request must not include another request''s entries');
        Assert.AreEqual(1, Mgt.CountTraces('REQ-I002'), 'Usage entries for one request must not include another request''s entries');
    end;
}
