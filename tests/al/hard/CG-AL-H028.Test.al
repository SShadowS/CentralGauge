codeunit 80228 "CG-AL-H028 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        Filter: Codeunit "CG H028 FieldRef Filter";

    [Test]
    procedure TestCountWhereFieldEquals_Code()
    begin
        SeedSamples();
        Assert.AreEqual(2, Filter.CountWhereFieldEquals(69280, 30, 'NORTH'),
            'Should count two NORTH samples');
    end;

    [Test]
    procedure TestCountWhereFieldEquals_Date()
    var
        D: Date;
    begin
        SeedSamples();
        D := DMY2Date(15, 3, 2024);
        Assert.AreEqual(2, Filter.CountWhereFieldEquals(69280, 10, D),
            'Should count two samples with Sale Date 2024-03-15');
    end;

    [Test]
    procedure TestCountWhereFieldEquals_Decimal()
    begin
        SeedSamples();
        Assert.AreEqual(1, Filter.CountWhereFieldEquals(69280, 20, 300.0),
            'Should count one sample with Amount 300');
    end;

    [Test]
    procedure TestGetFilterSafeText_Date()
    var
        Sample: Record "CG H028 Sample";
        RecRef: RecordRef;
    begin
        ResetSamples();
        Sample.Init();
        Sample.Code := 'X1';
        Sample."Sale Date" := DMY2Date(15, 3, 2024);
        Sample.Insert();
        RecRef.GetTable(Sample);
        Assert.AreEqual('2024-03-15', Filter.GetFilterSafeText(RecRef, 10),
            'XML date should be ISO 8601');
        RecRef.Close();
    end;

    [Test]
    procedure TestGetFilterSafeText_Decimal()
    var
        Sample: Record "CG H028 Sample";
        RecRef: RecordRef;
    begin
        ResetSamples();
        Sample.Init();
        Sample.Code := 'X2';
        Sample.Amount := 1234.5;
        Sample.Insert();
        RecRef.GetTable(Sample);
        Assert.AreEqual('1234.5', Filter.GetFilterSafeText(RecRef, 20),
            'XML decimal should use period as separator');
        RecRef.Close();
    end;

    [Test]
    procedure TestGetFilterSafeText_FieldMissing()
    var
        Sample: Record "CG H028 Sample";
        RecRef: RecordRef;
    begin
        ResetSamples();
        Sample.Init();
        Sample.Code := 'X3';
        Sample.Insert();
        RecRef.GetTable(Sample);
        Assert.AreEqual('', Filter.GetFilterSafeText(RecRef, 9999),
            'Missing field returns empty');
        RecRef.Close();
    end;

    [Test]
    procedure TestCountByDateRange()
    begin
        SeedSamples();
        Assert.AreEqual(3,
            Filter.CountByDateRange(69280, 10, DMY2Date(10, 3, 2024), DMY2Date(20, 3, 2024)),
            'Date range 10-20 March 2024 should match 3 samples');
    end;

    [Test]
    procedure TestCountByDateRange_NoMatch()
    begin
        SeedSamples();
        Assert.AreEqual(0,
            Filter.CountByDateRange(69280, 10, DMY2Date(1, 1, 2030), DMY2Date(31, 12, 2030)),
            'Date range with no matches returns 0');
    end;

    [Test]
    procedure TestCopyFieldFilter_Region()
    var
        Source: Record "CG H028 Sample";
        SourceRef: RecordRef;
        TargetRef: RecordRef;
    begin
        SeedSamples();
        Source.Get('S1');
        SourceRef.GetTable(Source);
        TargetRef.Open(69280);
        Filter.CopyFieldFilter(SourceRef, 30, TargetRef, 30);
        Assert.AreEqual(2, TargetRef.Count, 'Target filtered to NORTH count');
        SourceRef.Close();
        TargetRef.Close();
    end;

    local procedure SeedSamples()
    begin
        ResetSamples();
        InsertOne('S1', DMY2Date(15, 3, 2024), 100, 'NORTH');
        InsertOne('S2', DMY2Date(15, 3, 2024), 200, 'SOUTH');
        InsertOne('S3', DMY2Date(18, 3, 2024), 300, 'NORTH');
        InsertOne('S4', DMY2Date(25, 4, 2024), 400, 'EAST');
    end;

    local procedure ResetSamples()
    var
        S: Record "CG H028 Sample";
    begin
        if not S.IsEmpty() then
            S.DeleteAll();
    end;

    local procedure InsertOne(NewCode: Code[20]; SaleDate: Date; Amount: Decimal; Region: Code[10])
    var
        S: Record "CG H028 Sample";
    begin
        S.Init();
        S.Code := NewCode;
        S."Sale Date" := SaleDate;
        S.Amount := Amount;
        S.Region := Region;
        S.Insert();
    end;
}
