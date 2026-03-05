codeunit 80126 "CG-AL-H026 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        Converter: Codeunit "CG Record Converter";

    [Test]
    procedure TestRecordToRecordRef_TableId()
    var
        TestRecord: Record "CG Test Record";
        ResultRef: RecordRef;
    begin
        // [SCENARIO] RecordToRecordRef returns RecordRef with correct table
        // [GIVEN] A test record
        TestRecord.Code := 'R2R001';
        TestRecord.Description := 'Convert Test';

        // [WHEN] Converting to RecordRef
        ResultRef := Converter.RecordToRecordRef(TestRecord);

        // [THEN] RecordRef has correct table ID
        Assert.AreEqual(69225, ResultRef.Number, 'RecordRef should reference table 69225');

        ResultRef.Close();
    end;

    [Test]
    procedure TestRecordToRecordRef_FieldValues()
    var
        TestRecord: Record "CG Test Record";
        ResultRef: RecordRef;
        FRef: FieldRef;
    begin
        // [SCENARIO] RecordToRecordRef preserves field values
        // [GIVEN] A test record with data
        TestRecord.Code := 'R2R002';
        TestRecord.Description := 'Preserved Value';
        TestRecord.Amount := 123.45;

        // [WHEN] Converting to RecordRef
        ResultRef := Converter.RecordToRecordRef(TestRecord);

        // [THEN] Field values are preserved
        FRef := ResultRef.Field(1);
        Assert.AreEqual('R2R002', Format(FRef.Value), 'Code should be preserved');

        FRef := ResultRef.Field(2);
        Assert.AreEqual('Preserved Value', Format(FRef.Value), 'Description should be preserved');

        ResultRef.Close();
    end;

    [Test]
    procedure TestRecordRefToRecord_FieldValues()
    var
        SourceRecord: Record "CG Test Record";
        RecRef: RecordRef;
        ResultRecord: Record "CG Test Record";
    begin
        // [SCENARIO] RecordRefToRecord preserves field values
        // [GIVEN] A RecordRef with data
        SourceRecord.Code := 'RR2R01';
        SourceRecord.Description := 'RefToRec Test';
        SourceRecord.Amount := 67.89;
        RecRef.GetTable(SourceRecord);

        // [WHEN] Converting to Record
        ResultRecord := Converter.RecordRefToRecord(RecRef);

        // [THEN] Field values are preserved
        Assert.AreEqual('RR2R01', ResultRecord.Code, 'Code should be preserved');
        Assert.AreEqual('RefToRec Test', ResultRecord.Description, 'Description should be preserved');
        Assert.AreEqual(67.89, ResultRecord.Amount, 'Amount should be preserved');

        RecRef.Close();
    end;

    [Test]
    procedure TestPassRecordAsRecordRef_ReturnsTableName()
    var
        TestRecord: Record "CG Test Record";
        Result: Text;
    begin
        // [SCENARIO] PassRecordAsRecordRef passes Record where RecordRef is expected
        // [GIVEN] A test record
        TestRecord.Code := 'PASS01';

        // [WHEN] Passing record as RecordRef
        Result := Converter.PassRecordAsRecordRef(TestRecord);

        // [THEN] Returns table name
        Assert.IsTrue(Result.Contains('CG Test Record'), 'Should return table name containing CG Test Record');
    end;

    [Test]
    procedure TestRoundTripConversion_PreservesCode()
    var
        SourceRecord: Record "CG Test Record";
        ResultRecord: Record "CG Test Record";
    begin
        // [SCENARIO] RoundTripConversion preserves Code through Record->RecordRef->Record
        // [GIVEN] A source record
        SourceRecord.Code := 'TRIP01';
        SourceRecord.Description := 'Round Trip';
        SourceRecord.Amount := 555.55;
        SourceRecord.Active := true;

        // [WHEN] Doing round-trip conversion
        ResultRecord := Converter.RoundTripConversion(SourceRecord);

        // [THEN] Code is preserved
        Assert.AreEqual('TRIP01', ResultRecord.Code, 'Code should survive round trip');
    end;

    [Test]
    procedure TestRoundTripConversion_PreservesDescription()
    var
        SourceRecord: Record "CG Test Record";
        ResultRecord: Record "CG Test Record";
    begin
        // [SCENARIO] RoundTripConversion preserves Description
        // [GIVEN] A source record
        SourceRecord.Code := 'TRIP02';
        SourceRecord.Description := 'Description Survives';
        SourceRecord.Amount := 42.00;

        // [WHEN] Doing round-trip conversion
        ResultRecord := Converter.RoundTripConversion(SourceRecord);

        // [THEN] Description is preserved
        Assert.AreEqual('Description Survives', ResultRecord.Description, 'Description should survive round trip');
    end;

    [Test]
    procedure TestRoundTripConversion_PreservesAmount()
    var
        SourceRecord: Record "CG Test Record";
        ResultRecord: Record "CG Test Record";
    begin
        // [SCENARIO] RoundTripConversion preserves Amount
        // [GIVEN] A source record
        SourceRecord.Code := 'TRIP03';
        SourceRecord.Amount := 999.99;

        // [WHEN] Doing round-trip conversion
        ResultRecord := Converter.RoundTripConversion(SourceRecord);

        // [THEN] Amount is preserved
        Assert.AreEqual(999.99, ResultRecord.Amount, 'Amount should survive round trip');
    end;

    [Test]
    procedure TestRoundTripConversion_PreservesBoolean()
    var
        SourceRecord: Record "CG Test Record";
        ResultRecord: Record "CG Test Record";
    begin
        // [SCENARIO] RoundTripConversion preserves Boolean field
        // [GIVEN] A source record with Active = false
        SourceRecord.Code := 'TRIP04';
        SourceRecord.Active := false;

        // [WHEN] Doing round-trip conversion
        ResultRecord := Converter.RoundTripConversion(SourceRecord);

        // [THEN] Active is preserved
        Assert.AreEqual(false, ResultRecord.Active, 'Active should survive round trip');
    end;
}
