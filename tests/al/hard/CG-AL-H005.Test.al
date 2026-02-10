codeunit 80006 "CG-AL-H005 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure CleanupAll()
    var
        TrackedItem: Record "CG Tracked Item";
        AuditLog: Record "CG Audit Log";
    begin
        AuditLog.DeleteAll(false);
        TrackedItem.DeleteAll(false);
    end;

    [Test]
    procedure TestAuditLogOnPriceChange()
    var
        TrackedItem: Record "CG Tracked Item";
        AuditLog: Record "CG Audit Log";
    begin
        // [SCENARIO] Changing Unit Price creates audit log entry
        CleanupAll();

        TrackedItem.Init();
        TrackedItem.Code := 'AUDIT001';
        TrackedItem.Description := 'Test Item';
        TrackedItem."Unit Price" := 100;
        TrackedItem.Insert(false);

        // Change price - OnModify trigger should fire
        TrackedItem.Get('AUDIT001');
        TrackedItem."Unit Price" := 150;
        TrackedItem.Modify(true);

        // Verify audit log entry exists for Unit Price change
        AuditLog.SetRange("Field Changed", 'Unit Price');
        Assert.IsFalse(AuditLog.IsEmpty(), 'Audit log entry should exist for price change');
        AuditLog.FindFirst();
        Assert.AreNotEqual('', AuditLog."Old Value", 'Old Value should be set');
        Assert.AreNotEqual('', AuditLog."New Value", 'New Value should be set');
    end;

    [Test]
    procedure TestAuditLogOnBlockedChange()
    var
        TrackedItem: Record "CG Tracked Item";
        AuditLog: Record "CG Audit Log";
    begin
        // [SCENARIO] Changing Blocked from false to true creates audit log
        CleanupAll();

        TrackedItem.Init();
        TrackedItem.Code := 'AUDIT002';
        TrackedItem.Description := 'Test Item 2';
        TrackedItem."Unit Price" := 50;
        TrackedItem.Blocked := false;
        TrackedItem.Insert(false);

        // Block the item
        TrackedItem.Get('AUDIT002');
        TrackedItem.Blocked := true;
        TrackedItem.Modify(true);

        // Verify audit log
        AuditLog.SetRange("Field Changed", 'Blocked');
        AuditLog.SetRange("Old Value", 'No');
        AuditLog.SetRange("New Value", 'Yes');
        Assert.IsFalse(AuditLog.IsEmpty(), 'Audit log entry should exist for Blocked change');
    end;

    [Test]
    procedure TestNoAuditLogWhenUnblocking()
    var
        TrackedItem: Record "CG Tracked Item";
        AuditLog: Record "CG Audit Log";
    begin
        // [SCENARIO] Changing Blocked from true to false does NOT create audit log
        CleanupAll();

        TrackedItem.Init();
        TrackedItem.Code := 'AUDIT003';
        TrackedItem.Description := 'Test Item 3';
        TrackedItem."Unit Price" := 75;
        TrackedItem.Blocked := true;
        TrackedItem.Insert(false);

        // Unblock the item
        TrackedItem.Get('AUDIT003');
        TrackedItem.Blocked := false;
        TrackedItem.Modify(true);

        // Should not create new audit log for unblocking
        AuditLog.SetRange("Field Changed", 'Blocked');
        AuditLog.SetRange("Old Value", 'Yes');
        AuditLog.SetRange("New Value", 'No');
        Assert.IsTrue(AuditLog.IsEmpty(), 'Unblocking should NOT create audit log');
    end;

    [Test]
    procedure TestNoAuditLogWhenNoChange()
    var
        TrackedItem: Record "CG Tracked Item";
        AuditLog: Record "CG Audit Log";
    begin
        // [SCENARIO] Modifying without actual change should not create audit log
        CleanupAll();

        TrackedItem.Init();
        TrackedItem.Code := 'AUDIT004';
        TrackedItem.Description := 'Test Item 4';
        TrackedItem."Unit Price" := 200;
        TrackedItem.Insert(false);

        // Modify with same value
        TrackedItem.Get('AUDIT004');
        TrackedItem."Unit Price" := 200;
        TrackedItem.Modify(true);

        Assert.AreEqual(0, AuditLog.Count(), 'No audit log should be created when value unchanged');
    end;

    [Test]
    procedure TestAuditLogAutoIncrement()
    var
        TrackedItem: Record "CG Tracked Item";
        AuditLog: Record "CG Audit Log";
        FirstEntryNo: Integer;
        SecondEntryNo: Integer;
    begin
        // [SCENARIO] Audit log Entry No. auto-increments
        CleanupAll();

        TrackedItem.Init();
        TrackedItem.Code := 'AUDIT005';
        TrackedItem."Unit Price" := 10;
        TrackedItem.Insert(false);

        TrackedItem.Get('AUDIT005');
        TrackedItem."Unit Price" := 20;
        TrackedItem.Modify(true);

        Assert.IsFalse(AuditLog.IsEmpty(), 'Audit log should have entries after price change');
        AuditLog.FindLast();
        FirstEntryNo := AuditLog."Entry No.";

        TrackedItem.Get('AUDIT005');
        TrackedItem."Unit Price" := 30;
        TrackedItem.Modify(true);

        AuditLog.FindLast();
        SecondEntryNo := AuditLog."Entry No.";

        Assert.IsTrue(SecondEntryNo > FirstEntryNo, 'Entry No. should auto-increment');
    end;
}
