codeunit 88838 "CG-AL-X085 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods, so
    // every test clears both tables before seeding its own rows. Pre-existing
    // batches are always seeded Closed - a nonzero sentinel that a freshly
    // rebuilt header (always Open) cannot be confused with - so "left alone"
    // and "rebuilt" are never ambiguous from Status alone.

    local procedure Reset()
    var
        BatchHeader: Record "CG X085 Batch Header";
        ReissueSetup: Record "CG X085 Reissue Setup";
    begin
        BatchHeader.DeleteAll();
        ReissueSetup.DeleteAll();
    end;

    local procedure SeedSetup(TemplateCode: Code[20]; DefaultDescription: Text[100])
    var
        ReissueSetup: Record "CG X085 Reissue Setup";
    begin
        ReissueSetup.Init();
        ReissueSetup."Default Batch Template" := TemplateCode;
        ReissueSetup."Default Description" := DefaultDescription;
        ReissueSetup.Insert();
    end;

    local procedure SeedBatch(No: Code[20]; ExistingDescription: Text[100]; ExistingTemplateCode: Code[20]; ExistingCreatedDate: Date)
    var
        BatchHeader: Record "CG X085 Batch Header";
    begin
        BatchHeader.Init();
        BatchHeader."No." := No;
        BatchHeader.Description := ExistingDescription;
        BatchHeader."Template Code" := ExistingTemplateCode;
        BatchHeader."Created Date" := ExistingCreatedDate;
        BatchHeader.Status := BatchHeader.Status::Closed;
        BatchHeader.Insert();
    end;

    local procedure AssertRebuilt(No: Code[20]; ExpectedDescription: Text[100]; ExpectedTemplateCode: Code[20]; Msg: Text)
    var
        BatchHeader: Record "CG X085 Batch Header";
    begin
        Assert.IsTrue(BatchHeader.Get(No), StrSubstNo('Expected a header to exist for batch %1: %2', No, Msg));
        Assert.AreEqual(ExpectedDescription, BatchHeader.Description, Msg + ' (description)');
        Assert.AreEqual(ExpectedTemplateCode, BatchHeader."Template Code", Msg + ' (template code)');
        Assert.AreEqual(Today, BatchHeader."Created Date", Msg + ' (created date)');
        Assert.AreEqual(Format(BatchHeader.Status::Open), Format(BatchHeader.Status), Msg + ' (status)');
    end;

    local procedure AssertUnchanged(No: Code[20]; ExpectedDescription: Text[100]; ExpectedTemplateCode: Code[20]; ExpectedCreatedDate: Date; Msg: Text)
    var
        BatchHeader: Record "CG X085 Batch Header";
    begin
        Assert.IsTrue(BatchHeader.Get(No), StrSubstNo('Expected batch %1 to still have a header: %2', No, Msg));
        Assert.AreEqual(ExpectedDescription, BatchHeader.Description, Msg + ' (description)');
        Assert.AreEqual(ExpectedTemplateCode, BatchHeader."Template Code", Msg + ' (template code)');
        Assert.AreEqual(ExpectedCreatedDate, BatchHeader."Created Date", Msg + ' (created date)');
        Assert.AreEqual(Format(BatchHeader.Status::Closed), Format(BatchHeader.Status), Msg + ' (status)');
    end;

    local procedure AssertDoesNotExist(No: Code[20]; Msg: Text)
    var
        BatchHeader: Record "CG X085 Batch Header";
    begin
        Assert.IsFalse(BatchHeader.Get(No), Msg);
    end;

    local procedure AssertErrorContains(Fragment: Text)
    var
        ActualError: Text;
    begin
        ActualError := GetLastErrorText();
        Assert.IsTrue(LowerCase(ActualError).Contains(LowerCase(Fragment)),
            StrSubstNo('Expected the error to mention "%1", got: %2', Fragment, ActualError));
    end;

    [Test]
    procedure ReissueReplacesTheBatchWhenSetupIsComplete()
    var
        BatchReissueMgt: Codeunit "CG X085 Batch Reissue Mgt";
    begin
        Reset();
        SeedBatch('X85-B01', 'Old Description', 'OLD-TMPL', DMY2Date(1, 1, 2020));
        SeedSetup('NEW-TMPL', 'Fresh Batch');

        BatchReissueMgt.Reissue('X85-B01');

        AssertRebuilt('X85-B01', 'Fresh Batch', 'NEW-TMPL', 'A successful reissue must rebuild the batch from the configured template');
    end;

    [Test]
    procedure AFailedReissueLeavesTheOldBatchInPlaceWhenSetupIsMissing()
    var
        BatchReissueMgt: Codeunit "CG X085 Batch Reissue Mgt";
        OldCreatedDate: Date;
    begin
        Reset();
        OldCreatedDate := DMY2Date(15, 3, 2019);
        SeedBatch('X85-B02', 'Sentinel Description', 'SENT-TMPL', OldCreatedDate);
        // No Reissue Setup record exists at all.
        Commit();

        asserterror BatchReissueMgt.Reissue('X85-B02');

        AssertUnchanged('X85-B02', 'Sentinel Description', 'SENT-TMPL', OldCreatedDate,
            'A reissue that fails because the setup does not exist must leave the existing batch exactly as it was');
    end;

    [Test]
    procedure AFailedReissueLeavesTheOldBatchInPlaceWhenTheTemplateIsBlank()
    var
        BatchReissueMgt: Codeunit "CG X085 Batch Reissue Mgt";
        OldCreatedDate: Date;
    begin
        Reset();
        OldCreatedDate := DMY2Date(4, 7, 2018);
        SeedBatch('X85-B03', 'Sentinel Description Two', 'SENT-TMPL-2', OldCreatedDate);
        SeedSetup('', 'Some Description');
        Commit();

        asserterror BatchReissueMgt.Reissue('X85-B03');

        AssertErrorContains('Default Batch Template');
        AssertErrorContains('must have a value');
        AssertUnchanged('X85-B03', 'Sentinel Description Two', 'SENT-TMPL-2', OldCreatedDate,
            'A reissue that fails because the template is blank must leave the existing batch exactly as it was');
    end;

    [Test]
    procedure ARepairedSetupLetsAPreviouslyFailedBatchBeReissued()
    var
        BatchReissueMgt: Codeunit "CG X085 Batch Reissue Mgt";
        OldCreatedDate: Date;
    begin
        Reset();
        OldCreatedDate := DMY2Date(9, 9, 2017);
        SeedBatch('X85-B04', 'Original Description', 'ORIG-TMPL', OldCreatedDate);
        Commit();

        asserterror BatchReissueMgt.Reissue('X85-B04');
        AssertUnchanged('X85-B04', 'Original Description', 'ORIG-TMPL', OldCreatedDate,
            'The first, failing attempt must not touch the existing batch');

        SeedSetup('FIXED-TMPL', 'Repaired Batch');

        BatchReissueMgt.Reissue('X85-B04');

        AssertRebuilt('X85-B04', 'Repaired Batch', 'FIXED-TMPL',
            'Once the setup is fixed, reissuing the same batch must rebuild it from the template with nothing left over from the failed attempt');
    end;

    [Test]
    procedure ReissueOnlyAffectsTheGivenBatch()
    var
        BatchReissueMgt: Codeunit "CG X085 Batch Reissue Mgt";
        NeighbourCreatedDate: Date;
    begin
        Reset();
        NeighbourCreatedDate := DMY2Date(2, 2, 2021);
        SeedBatch('X85-B05A', 'Target Old', 'TGT-OLD', DMY2Date(1, 1, 2021));
        SeedBatch('X85-B05B', 'Neighbour Description', 'NEI-TMPL', NeighbourCreatedDate);
        SeedSetup('TGT-NEW', 'Target Rebuilt');

        BatchReissueMgt.Reissue('X85-B05A');

        AssertRebuilt('X85-B05A', 'Target Rebuilt', 'TGT-NEW', 'The targeted batch must be rebuilt');
        AssertUnchanged('X85-B05B', 'Neighbour Description', 'NEI-TMPL', NeighbourCreatedDate,
            'A neighbour batch must be left untouched by reissuing a different batch');
    end;

    [Test]
    procedure ReissueCreatesAHeaderForABatchThatHadNoneYet()
    var
        BatchReissueMgt: Codeunit "CG X085 Batch Reissue Mgt";
    begin
        Reset();
        SeedSetup('FRESH-TMPL', 'Brand New Batch');

        BatchReissueMgt.Reissue('X85-B06');

        AssertRebuilt('X85-B06', 'Brand New Batch', 'FRESH-TMPL', 'Reissuing a batch number with no existing header must still build one from the template');
    end;

    [Test]
    procedure AFailedReissueOnABatchWithNoExistingHeaderCreatesNothing()
    var
        BatchReissueMgt: Codeunit "CG X085 Batch Reissue Mgt";
    begin
        Reset();
        Commit();
        // No Reissue Setup record, and no existing header for this batch either.

        asserterror BatchReissueMgt.Reissue('X85-B07');

        AssertDoesNotExist('X85-B07', 'A batch that never had a header and fails setup validation must still have none afterward');
    end;
}
