codeunit 80333 "CG-AL-X044 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure Reset()
    var
        Widget: Record "CG X044 Widget";
        DocAttach: Record "Document Attachment";
    begin
        DocAttach.SetRange("Table ID", Database::"CG X044 Widget");
        DocAttach.DeleteAll();
        DocAttach.Reset();
        DocAttach.SetRange("Table ID", Database::Customer);
        DocAttach.SetRange("No.", 'DECOY-X044');
        DocAttach.DeleteAll();
        DocAttach.Reset();
        Widget.DeleteAll();
        Commit();

        InsertDecoyAttachment(Database::Customer, 'DECOY-X044', 'decoy.txt');
        Commit();
    end;

    local procedure InsertDecoyAttachment(TableID: Integer; RecNo: Code[20]; FileNameText: Text)
    var
        DocAttach: Record "Document Attachment";
        TempBlob: Codeunit "Temp Blob";
        InStr: InStream;
    begin
        MakeBlob('decoy-content', TempBlob);
        TempBlob.CreateInStream(InStr);

        DocAttach.Init();
        DocAttach.Validate("Table ID", TableID);
        DocAttach.Validate("No.", RecNo);
        DocAttach.ImportFromStream(InStr, FileNameText);
        DocAttach.Insert(true);
    end;

    local procedure MakeBlob(Content: Text; var TempBlob: Codeunit "Temp Blob")
    var
        OutStr: OutStream;
    begin
        Clear(TempBlob);
        TempBlob.CreateOutStream(OutStr);
        OutStr.WriteText(Content);
    end;

    local procedure CountFor(Widget: Record "CG X044 Widget"): Integer
    var
        DocAttach: Record "Document Attachment";
        DocAttachMgmt: Codeunit "Document Attachment Mgmt";
        RecRef: RecordRef;
    begin
        RecRef.GetTable(Widget);
        DocAttachMgmt.SetDocumentAttachmentFiltersForRecRef(DocAttach, RecRef);
        exit(DocAttach.Count());
    end;

    local procedure AssertDecoyIntact()
    var
        DocAttach: Record "Document Attachment";
    begin
        DocAttach.SetRange("Table ID", Database::Customer);
        DocAttach.SetRange("No.", 'DECOY-X044');
        Assert.AreEqual(1, DocAttach.Count(), 'The pre-existing unrelated Customer attachment must never be touched');
    end;

    [Test]
    procedure AttachmentIsScopedToOwningRecord()
    var
        WidgetA: Record "CG X044 Widget";
        WidgetB: Record "CG X044 Widget";
        AttachMgt: Codeunit "CG X044 Attach Mgt";
        TempBlob: Codeunit "Temp Blob";
    begin
        Reset();

        WidgetA.Init();
        WidgetA."No." := 'WIDGET-A';
        WidgetA.Insert();

        WidgetB.Init();
        WidgetB."No." := 'WIDGET-B';
        WidgetB.Insert();

        MakeBlob('content-a', TempBlob);
        AttachMgt.AttachFile(WidgetA, 'a.txt', TempBlob);

        Assert.AreEqual(1, CountFor(WidgetA), 'Widget A must have exactly one attachment after attaching one file');
        Assert.AreEqual(0, CountFor(WidgetB), 'Widget B must have no attachments when only Widget A received one');
        AssertDecoyIntact();
    end;

    [Test]
    procedure MultipleRecordsStayIndependentlyScoped()
    var
        WidgetA: Record "CG X044 Widget";
        WidgetB: Record "CG X044 Widget";
        AttachMgt: Codeunit "CG X044 Attach Mgt";
        TempBlob: Codeunit "Temp Blob";
    begin
        Reset();

        WidgetA.Init();
        WidgetA."No." := 'WIDGET-A';
        WidgetA.Insert();

        WidgetB.Init();
        WidgetB."No." := 'WIDGET-B';
        WidgetB.Insert();

        MakeBlob('content-a1', TempBlob);
        AttachMgt.AttachFile(WidgetA, 'a1.txt', TempBlob);
        MakeBlob('content-b1', TempBlob);
        AttachMgt.AttachFile(WidgetB, 'b1.txt', TempBlob);
        MakeBlob('content-a2', TempBlob);
        AttachMgt.AttachFile(WidgetA, 'a2.txt', TempBlob);

        Assert.AreEqual(2, CountFor(WidgetA), 'Widget A must accumulate exactly the two files attached to it');
        Assert.AreEqual(1, CountFor(WidgetB), 'Widget B must have exactly the one file attached to it, unaffected by Widget A''s second attachment');
        AssertDecoyIntact();
    end;

    [Test]
    procedure AttachmentContentIsRetrievableForOwningRecord()
    var
        Widget: Record "CG X044 Widget";
        DocAttach: Record "Document Attachment";
        DocAttachMgmt: Codeunit "Document Attachment Mgmt";
        AttachMgt: Codeunit "CG X044 Attach Mgt";
        TempBlob: Codeunit "Temp Blob";
        ReadBlob: Codeunit "Temp Blob";
        RecRef: RecordRef;
        InStr: InStream;
        ReadContent: Text;
    begin
        Reset();

        Widget.Init();
        Widget."No." := 'WIDGET-C';
        Widget.Insert();

        MakeBlob('opaque-payload-4471', TempBlob);
        AttachMgt.AttachFile(Widget, 'c.txt', TempBlob);

        RecRef.GetTable(Widget);
        DocAttachMgmt.SetDocumentAttachmentFiltersForRecRef(DocAttach, RecRef);
        Assert.IsTrue(DocAttach.FindFirst(), 'Widget C must have a locatable attachment row');
        DocAttach.GetAsTempBlob(ReadBlob);
        ReadBlob.CreateInStream(InStr);
        InStr.ReadText(ReadContent);
        Assert.AreEqual('opaque-payload-4471', ReadContent, 'The stored attachment content must round-trip for the owning record');
    end;
}
