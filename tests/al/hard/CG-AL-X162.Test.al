codeunit 89382 "CG-AL-X162 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        Consolidator: Codeunit "CG X162 Consolidator";
        SetupMgt: Codeunit "CG X162 Setup Mgt";

    // Companies are enumerated at runtime, never hardcoded. Every test that
    // touches the other company clears both companies' source readings and
    // the collected list BEFORE seeding and AGAIN before asserting, and
    // Commit()s each clear - so cleanup is durable even if an assertion in
    // the same test raises an error. Meter numbers are prefixed per
    // company (H.. / O..) so a run never has to overwrite one company's row
    // with the other's value, keeping row-count and total assertions
    // independent of which company a reading ends up filed under.

    local procedure GetOtherCompanyName(): Text[30]
    var
        Company: Record Company;
        HereName: Text[30];
    begin
        HereName := CompanyName();
        Company.SetFilter(Name, '<>%1', HereName);
        if Company.FindFirst() then
            exit(Company.Name);
        Error('Expected at least one other company to exist on this container to verify cross-company isolation');
    end;

    local procedure ClearHomeMeterReadings()
    var
        MeterReading: Record "CG X162 Meter Reading";
    begin
        MeterReading.DeleteAll();
    end;

    local procedure ClearOtherMeterReadings(OtherName: Text[30])
    var
        MeterReading: Record "CG X162 Meter Reading";
    begin
        MeterReading.ChangeCompany(OtherName);
        MeterReading.DeleteAll();
    end;

    local procedure ClearCollected()
    var
        CollectedReading: Record "CG X162 Collected Reading";
    begin
        CollectedReading.DeleteAll();
    end;

    local procedure ClearAll(OtherName: Text[30])
    begin
        ClearHomeMeterReadings();
        ClearOtherMeterReadings(OtherName);
        ClearCollected();
        Commit();
    end;

    local procedure SumAllCollected(): Decimal
    var
        CollectedReading: Record "CG X162 Collected Reading";
        Total: Decimal;
    begin
        if CollectedReading.FindSet() then
            repeat
                Total += CollectedReading.Quantity;
            until CollectedReading.Next() = 0;
        exit(Total);
    end;

    local procedure SumCollectedForCompany(SourceCompanyName: Text[30]): Decimal
    var
        CollectedReading: Record "CG X162 Collected Reading";
        Total: Decimal;
    begin
        CollectedReading.SetRange("Source Company", SourceCompanyName);
        if CollectedReading.FindSet() then
            repeat
                Total += CollectedReading.Quantity;
            until CollectedReading.Next() = 0;
        exit(Total);
    end;

    local procedure CountAllCollected(): Integer
    var
        CollectedReading: Record "CG X162 Collected Reading";
    begin
        exit(CollectedReading.Count());
    end;

    [Test]
    procedure TheOverallCollectedTotalIsCorrect()
    var
        OtherName: Text[30];
        HomeName: Text[30];
        Total: Decimal;
    begin
        OtherName := GetOtherCompanyName();
        HomeName := CompanyName();
        ClearAll(OtherName);

        SetupMgt.SetMeterReading(HomeName, 'H1', 5);
        SetupMgt.SetMeterReading(HomeName, 'H2', 3);
        SetupMgt.SetMeterReading(OtherName, 'O1', 9);
        SetupMgt.SetMeterReading(OtherName, 'O2', 2);

        Consolidator.CollectReadings();

        Total := SumAllCollected();

        ClearAll(OtherName);

        Assert.AreEqual(19.0, Total,
            'Expected the collected list''s total quantity to equal the sum of every reading collected from every company');
    end;

    [Test]
    procedure ReadingsFromTheOtherCompanyAreFiledUnderTheCompanyTheyCameFrom()
    var
        OtherName: Text[30];
        HomeName: Text[30];
        CollectedReading: Record "CG X162 Collected Reading";
        FiledUnderOther: Boolean;
        MisfiledUnderHome: Boolean;
        OtherQty: Decimal;
    begin
        OtherName := GetOtherCompanyName();
        HomeName := CompanyName();
        ClearAll(OtherName);

        SetupMgt.SetMeterReading(HomeName, 'H1', 5);
        SetupMgt.SetMeterReading(OtherName, 'O1', 9);

        Consolidator.CollectReadings();

        FiledUnderOther := CollectedReading.Get(OtherName, 'O1');
        if FiledUnderOther then
            OtherQty := CollectedReading.Quantity;
        MisfiledUnderHome := CollectedReading.Get(HomeName, 'O1');

        ClearAll(OtherName);

        Assert.IsTrue(FiledUnderOther,
            'Expected the reading recorded by the other company to be filed in the collected list under the other company');
        Assert.AreEqual(9.0, OtherQty,
            'Expected the reading filed under the other company to keep its own recorded quantity');
        Assert.IsFalse(MisfiledUnderHome,
            'Expected the reading recorded by the other company not to be filed under this company');
    end;

    [Test]
    procedure TheHomeCompanysOwnReadingIsFiledUnderItself()
    var
        OtherName: Text[30];
        HomeName: Text[30];
        CollectedReading: Record "CG X162 Collected Reading";
        Filed: Boolean;
    begin
        OtherName := GetOtherCompanyName();
        HomeName := CompanyName();
        ClearAll(OtherName);

        SetupMgt.SetMeterReading(HomeName, 'H1', 5);

        Consolidator.CollectReadings();

        Filed := CollectedReading.Get(HomeName, 'H1');

        ClearAll(OtherName);

        Assert.IsTrue(Filed,
            'Expected this company''s own reading to be filed under this company');
        Assert.AreEqual(5.0, CollectedReading.Quantity,
            'Expected this company''s own reading to keep its own recorded quantity');
    end;

    [Test]
    procedure SubtotalsPerCompanyReflectWhereEachReadingCameFrom()
    var
        OtherName: Text[30];
        HomeName: Text[30];
        HomeSubtotal: Decimal;
        OtherSubtotal: Decimal;
    begin
        OtherName := GetOtherCompanyName();
        HomeName := CompanyName();
        ClearAll(OtherName);

        SetupMgt.SetMeterReading(HomeName, 'H1', 5);
        SetupMgt.SetMeterReading(HomeName, 'H2', 3);
        SetupMgt.SetMeterReading(OtherName, 'O1', 9);
        SetupMgt.SetMeterReading(OtherName, 'O2', 2);

        Consolidator.CollectReadings();

        HomeSubtotal := SumCollectedForCompany(HomeName);
        OtherSubtotal := SumCollectedForCompany(OtherName);

        ClearAll(OtherName);

        Assert.AreEqual(8.0, HomeSubtotal,
            'Expected the subtotal filed under this company to equal only the readings this company recorded');
        Assert.AreEqual(11.0, OtherSubtotal,
            'Expected the subtotal filed under the other company to equal only the readings the other company recorded');
    end;

    [Test]
    procedure ACompanyWithNoReadingsContributesNothingToTheCollectedList()
    var
        OtherName: Text[30];
        HomeName: Text[30];
        RowCount: Integer;
    begin
        OtherName := GetOtherCompanyName();
        HomeName := CompanyName();
        ClearAll(OtherName);

        SetupMgt.SetMeterReading(HomeName, 'H1', 5);

        Consolidator.CollectReadings();

        RowCount := CountAllCollected();

        ClearAll(OtherName);

        Assert.AreEqual(1, RowCount,
            'Expected a company with no readings to add nothing to the collected list');
    end;

    [Test]
    procedure SourceMeterReadingsAreUnchangedAfterCollection()
    var
        OtherName: Text[30];
        HomeName: Text[30];
        HomeQtyAfter: Decimal;
        OtherQtyAfter: Decimal;
    begin
        OtherName := GetOtherCompanyName();
        HomeName := CompanyName();
        ClearAll(OtherName);

        SetupMgt.SetMeterReading(HomeName, 'H1', 5);
        SetupMgt.SetMeterReading(OtherName, 'O1', 9);

        Consolidator.CollectReadings();

        HomeQtyAfter := SetupMgt.GetMeterReading(HomeName, 'H1');
        OtherQtyAfter := SetupMgt.GetMeterReading(OtherName, 'O1');

        ClearAll(OtherName);

        Assert.AreEqual(5.0, HomeQtyAfter,
            'Expected this company''s recorded meter reading to be unchanged by collecting it into the list');
        Assert.AreEqual(9.0, OtherQtyAfter,
            'Expected the other company''s recorded meter reading to be unchanged by collecting it into the list');
    end;

    [Test]
    procedure RunningCollectionAgainReplacesEachReadingRatherThanDuplicatingIt()
    var
        OtherName: Text[30];
        HomeName: Text[30];
        RowCountAfterFirstRun: Integer;
        RowCountAfterSecondRun: Integer;
        TotalAfterFirstRun: Decimal;
        TotalAfterSecondRun: Decimal;
    begin
        OtherName := GetOtherCompanyName();
        HomeName := CompanyName();
        ClearAll(OtherName);

        SetupMgt.SetMeterReading(HomeName, 'H1', 5);
        SetupMgt.SetMeterReading(OtherName, 'O1', 9);

        Consolidator.CollectReadings();
        RowCountAfterFirstRun := CountAllCollected();
        TotalAfterFirstRun := SumAllCollected();

        SetupMgt.SetMeterReading(HomeName, 'H1', 8);
        Consolidator.CollectReadings();
        RowCountAfterSecondRun := CountAllCollected();
        TotalAfterSecondRun := SumAllCollected();

        ClearAll(OtherName);

        Assert.AreEqual(RowCountAfterFirstRun, RowCountAfterSecondRun,
            'Expected running the collection again to replace each company''s reading rather than adding another row for it');
        Assert.AreEqual(14.0, TotalAfterFirstRun,
            'Expected the first collection to total the readings recorded at that point');
        Assert.AreEqual(17.0, TotalAfterSecondRun,
            'Expected collecting again after a reading changed to reflect its newly recorded quantity rather than the old one');
    end;
}
