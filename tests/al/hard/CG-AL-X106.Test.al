codeunit 89300 "CG-AL-X106 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods, so
    // every test clears the table before seeding its own rows.

    local procedure Seed(No: Code[20]; BaseTotal: Integer)
    var
        Doc: Record "CG X106 Document";
    begin
        Doc.Init();
        Doc."No." := No;
        Doc."Base Total" := BaseTotal;
        Doc.Insert();
    end;

    [Test]
    procedure ArchivingAQualifyingDocumentKeepsTheEnrichmentNoteAndTheArchiveTag()
    var
        Doc: Record "CG X106 Document";
        ArchiveMgt: Codeunit "CG X106 Archive Mgt";
    begin
        Doc.DeleteAll();
        Seed('DOC001', 100);

        ArchiveMgt.ArchiveDocument('DOC001');

        Doc.Get('DOC001');
        Assert.AreEqual('NOTE-100', Doc."Enrichment Note", 'The archived document must keep the note describing its total');
        Assert.AreEqual('PRIORITY', Doc."Archive Tag", 'A document at the qualifying total must be tagged as priority');
        Assert.AreEqual(100, Doc."Base Total", 'Archiving must not change the document''s recorded total');
    end;

    [Test]
    procedure ArchivingABelowThresholdDocumentKeepsTheEnrichmentNoteAndTheArchiveTag()
    var
        Doc: Record "CG X106 Document";
        ArchiveMgt: Codeunit "CG X106 Archive Mgt";
    begin
        Doc.DeleteAll();
        Seed('DOC002', 99);

        ArchiveMgt.ArchiveDocument('DOC002');

        Doc.Get('DOC002');
        Assert.AreEqual('NOTE-99', Doc."Enrichment Note", 'The archived document must keep the note describing its total');
        Assert.AreEqual('STANDARD', Doc."Archive Tag", 'A document below the qualifying total must be tagged as standard');
    end;

    [Test]
    procedure ArchivingOneDocumentDoesNotChangeAnother()
    var
        Target: Record "CG X106 Document";
        Other: Record "CG X106 Document";
        ArchiveMgt: Codeunit "CG X106 Archive Mgt";
    begin
        Target.DeleteAll();
        Target.Init();
        Target."No." := 'TARGET';
        Target."Base Total" := 250;
        Target.Insert();

        Other.Init();
        Other."No." := 'OTHER';
        Other."Base Total" := 555;
        Other."Enrichment Note" := 'UNTOUCHED-NOTE';
        Other."Archive Tag" := 'UNTOUCHED-TAG';
        Other.Insert();

        ArchiveMgt.ArchiveDocument('TARGET');

        Other.Get('OTHER');
        Assert.AreEqual(555, Other."Base Total", 'An unrelated document''s total must not change');
        Assert.AreEqual('UNTOUCHED-NOTE', Other."Enrichment Note", 'An unrelated document''s enrichment note must not change');
        Assert.AreEqual('UNTOUCHED-TAG', Other."Archive Tag", 'An unrelated document''s archive tag must not change');
    end;

    [Test]
    procedure RefreshingTheArchiveTagAloneLeavesTheEnrichmentNoteUntouched()
    var
        Doc: Record "CG X106 Document";
        ArchiveMgt: Codeunit "CG X106 Archive Mgt";
    begin
        Doc.DeleteAll();
        Doc.Init();
        Doc."No." := 'DOC003';
        Doc."Base Total" := 400;
        Doc."Enrichment Note" := 'PRESEEDED-NOTE';
        Doc.Insert();

        ArchiveMgt.RefreshArchiveTag('DOC003');

        Doc.Get('DOC003');
        Assert.AreEqual('PRIORITY', Doc."Archive Tag", 'A document at or above the qualifying total must be tagged as priority');
        Assert.AreEqual('PRESEEDED-NOTE', Doc."Enrichment Note", 'Refreshing the archive tag alone must not touch the enrichment note');
    end;

    [Test]
    procedure RefreshingTheArchiveTagAloneHandlesTheStandardCase()
    var
        Doc: Record "CG X106 Document";
        ArchiveMgt: Codeunit "CG X106 Archive Mgt";
    begin
        Doc.DeleteAll();
        Doc.Init();
        Doc."No." := 'DOC004';
        Doc."Base Total" := 20;
        Doc."Enrichment Note" := 'PRESEEDED-NOTE-2';
        Doc.Insert();

        ArchiveMgt.RefreshArchiveTag('DOC004');

        Doc.Get('DOC004');
        Assert.AreEqual('STANDARD', Doc."Archive Tag", 'A document below the qualifying total must be tagged as standard');
        Assert.AreEqual('PRESEEDED-NOTE-2', Doc."Enrichment Note", 'Refreshing the archive tag alone must not touch the enrichment note');
    end;
}
