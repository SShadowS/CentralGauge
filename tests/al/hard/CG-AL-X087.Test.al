codeunit 89084 "CG-AL-X087 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods, so
    // every test clears the table before seeding its own rows.

    local procedure Reset()
    var
        Header: Record "CG X087 Document Header";
    begin
        Header.DeleteAll();
    end;

    local procedure SeedSource(No: Code[20]; DescriptionValue: Text[100])
    var
        Header: Record "CG X087 Document Header";
    begin
        Header.Init();
        Header."No." := No;
        Header.Description := DescriptionValue;
        Header.Status := Header.Status::Open;
        Header.Insert();
    end;

    [Test]
    procedure CopyingADocumentEndsUpReleasedAndAudited()
    var
        Header: Record "CG X087 Document Header";
        SourceHeader: Record "CG X087 Document Header";
        CopyMgt: Codeunit "CG X087 Document Copy Mgt";
    begin
        Reset();
        SeedSource('SRC001', 'Original document');

        CopyMgt.CopyDocument('SRC001', 'NEW001');

        Header.Get('NEW001');
        Assert.AreEqual('SRC001', Header."Copied From No.", 'The copy must record which document it came from');
        Assert.AreEqual('Original document', Header.Description, 'The copy must carry over the source description');
        Assert.AreEqual(Header.Status::Released, Header.Status, 'The copy must end up released');
        Assert.AreEqual('REL-NEW001', Header."Release Reference", 'The copy must keep the release reference recorded when it was released');
        Assert.IsTrue(Header."Copy Audited", 'The copy must be marked as audited');

        SourceHeader.Get('SRC001');
        Assert.AreEqual(SourceHeader.Status::Open, SourceHeader.Status, 'The source document must be left untouched');
        Assert.AreEqual('', SourceHeader."Release Reference", 'The source document must not gain a release reference');
        Assert.IsFalse(SourceHeader."Copy Audited", 'The source document must not be marked as audited');
    end;

    [Test]
    procedure AuditingADocumentDirectlyLeavesOtherFieldsUnchanged()
    var
        Header: Record "CG X087 Document Header";
        CopyMgt: Codeunit "CG X087 Document Copy Mgt";
    begin
        Reset();
        Header.Init();
        Header."No." := 'STANDALONE';
        Header.Description := 'Directly entered document';
        Header.Status := Header.Status::Copied;
        Header.Insert();

        CopyMgt.AuditDocument('STANDALONE');

        Header.Get('STANDALONE');
        Assert.IsTrue(Header."Copy Audited", 'A directly audited document must be marked as audited');
        Assert.AreEqual(Header.Status::Copied, Header.Status, 'Auditing a document must not change its status, even one currently showing as copied');
        Assert.AreEqual('', Header."Release Reference", 'Auditing a document directly must not invent a release reference');
    end;

    [Test]
    procedure AuditingOneDocumentDoesNotChangeAnother()
    var
        Target: Record "CG X087 Document Header";
        Other: Record "CG X087 Document Header";
        CopyMgt: Codeunit "CG X087 Document Copy Mgt";
    begin
        Reset();
        Target.Init();
        Target."No." := 'TARGET';
        Target.Description := 'Document to audit';
        Target.Status := Target.Status::Open;
        Target.Insert();

        Other.Init();
        Other."No." := 'OTHER';
        Other.Description := 'Unrelated document';
        Other.Status := Other.Status::Released;
        Other."Copy Audited" := true;
        Other."Release Reference" := 'REL-OTHER';
        Other.Insert();

        CopyMgt.AuditDocument('TARGET');

        Other.Get('OTHER');
        Assert.AreEqual(Other.Status::Released, Other.Status, 'An unrelated document''s status must not change');
        Assert.IsTrue(Other."Copy Audited", 'An unrelated document''s audited flag must not change');
        Assert.AreEqual('Unrelated document', Other.Description, 'An unrelated document''s description must not change');
        Assert.AreEqual('REL-OTHER', Other."Release Reference", 'An unrelated document''s release reference must not change');
    end;
}
