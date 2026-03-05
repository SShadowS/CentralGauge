codeunit 80124 "CG-AL-H024 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        FieldAccessor: Codeunit "CG Named Field Accessor";

    [Test]
    procedure TestGetFieldByName_ValidField()
    var
        TestRecord: Record "CG Test Record";
        RecRef: RecordRef;
        Result: Text;
    begin
        // [SCENARIO] GetFieldByName returns the value of an existing field
        // [GIVEN] A record with data
        TestRecord.Code := 'FBN001';
        TestRecord.Description := 'Field By Name Test';
        RecRef.GetTable(TestRecord);

        // [WHEN] Getting field by name
        Result := FieldAccessor.GetFieldByName(RecRef, 'Description');

        // [THEN] Returns the field value
        Assert.AreEqual('Field By Name Test', Result, 'Should return Description value');

        RecRef.Close();
    end;

    [Test]
    procedure TestGetFieldByName_InvalidField()
    var
        TestRecord: Record "CG Test Record";
        RecRef: RecordRef;
        Result: Text;
    begin
        // [SCENARIO] GetFieldByName returns empty for non-existent field
        // [GIVEN] A record
        TestRecord.Code := 'FBN002';
        RecRef.GetTable(TestRecord);

        // [WHEN] Getting non-existent field
        Result := FieldAccessor.GetFieldByName(RecRef, 'NonExistentField');

        // [THEN] Returns empty text
        Assert.AreEqual('', Result, 'Should return empty for non-existent field');

        RecRef.Close();
    end;

    [Test]
    procedure TestFieldExistsByName_Exists()
    var
        TestRecord: Record "CG Test Record";
        RecRef: RecordRef;
    begin
        // [SCENARIO] FieldExistsByName returns true for existing field
        // [GIVEN] A record
        TestRecord.Code := 'FEX001';
        RecRef.GetTable(TestRecord);

        // [WHEN/THEN] Checking field existence
        Assert.IsTrue(FieldAccessor.FieldExistsByName(RecRef, 'Code'), 'Code field should exist');
        Assert.IsTrue(FieldAccessor.FieldExistsByName(RecRef, 'Description'), 'Description field should exist');
        Assert.IsTrue(FieldAccessor.FieldExistsByName(RecRef, 'Amount'), 'Amount field should exist');

        RecRef.Close();
    end;

    [Test]
    procedure TestFieldExistsByName_NotExists()
    var
        TestRecord: Record "CG Test Record";
        RecRef: RecordRef;
    begin
        // [SCENARIO] FieldExistsByName returns false for non-existent field
        // [GIVEN] A record
        TestRecord.Code := 'FEX002';
        RecRef.GetTable(TestRecord);

        // [WHEN/THEN] Checking non-existent field
        Assert.IsFalse(FieldAccessor.FieldExistsByName(RecRef, 'FakeField'), 'FakeField should not exist');

        RecRef.Close();
    end;

    [Test]
    procedure TestSetFieldByName_SetsValue()
    var
        TestRecord: Record "CG Test Record";
        RecRef: RecordRef;
        Result: Text;
    begin
        // [SCENARIO] SetFieldByName sets a field value by name
        // [GIVEN] A record
        TestRecord.Code := 'SET001';
        TestRecord.Description := 'Original';
        RecRef.GetTable(TestRecord);

        // [WHEN] Setting field by name
        FieldAccessor.SetFieldByName(RecRef, 'Description', 'Updated');

        // [THEN] Field value is updated
        Result := FieldAccessor.GetFieldByName(RecRef, 'Description');
        Assert.AreEqual('Updated', Result, 'Description should be updated');

        RecRef.Close();
    end;

    [Test]
    procedure TestCopyFieldsByName_CopiesValues()
    var
        SourceRecord: Record "CG Test Record";
        DestRecord: Record "CG Test Record";
        SourceRecRef: RecordRef;
        DestRecRef: RecordRef;
        FieldNames: List of [Text];
        Result: Text;
    begin
        // [SCENARIO] CopyFieldsByName copies specified fields from source to dest
        // [GIVEN] Source and destination records
        SourceRecord.Code := 'CPY001';
        SourceRecord.Description := 'Source Description';
        SourceRecRef.GetTable(SourceRecord);

        DestRecord.Code := 'CPY002';
        DestRecord.Description := '';
        DestRecRef.GetTable(DestRecord);

        FieldNames.Add('Description');

        // [WHEN] Copying fields
        FieldAccessor.CopyFieldsByName(SourceRecRef, DestRecRef, FieldNames);

        // [THEN] Description is copied
        Result := FieldAccessor.GetFieldByName(DestRecRef, 'Description');
        Assert.AreEqual('Source Description', Result, 'Description should be copied from source');

        SourceRecRef.Close();
        DestRecRef.Close();
    end;

    [Test]
    procedure TestGetAllFieldNames_ReturnsFields()
    var
        TestRecord: Record "CG Test Record";
        RecRef: RecordRef;
        FieldNames: List of [Text];
    begin
        // [SCENARIO] GetAllFieldNames returns all field names
        // [GIVEN] A record
        TestRecord.Code := 'ALL001';
        RecRef.GetTable(TestRecord);

        // [WHEN] Getting all field names
        FieldNames := FieldAccessor.GetAllFieldNames(RecRef);

        // [THEN] Contains expected fields
        Assert.IsTrue(FieldNames.Count >= 5, 'Should have at least 5 fields');
        Assert.IsTrue(FieldNames.Contains('Code'), 'Should contain Code');
        Assert.IsTrue(FieldNames.Contains('Description'), 'Should contain Description');
        Assert.IsTrue(FieldNames.Contains('Amount'), 'Should contain Amount');
        Assert.IsTrue(FieldNames.Contains('Active'), 'Should contain Active');

        RecRef.Close();
    end;

    [Test]
    procedure TestBuildFieldMap_ContainsValues()
    var
        TestRecord: Record "CG Test Record";
        RecRef: RecordRef;
        FieldMap: Dictionary of [Text, Text];
        MapValue: Text;
    begin
        // [SCENARIO] BuildFieldMap returns dictionary of field name to value
        // [GIVEN] A record with data
        TestRecord.Code := 'MAP001';
        TestRecord.Description := 'Map Test';
        TestRecord.Amount := 42.5;
        RecRef.GetTable(TestRecord);

        // [WHEN] Building field map
        FieldMap := FieldAccessor.BuildFieldMap(RecRef);

        // [THEN] Map contains field values
        Assert.IsTrue(FieldMap.Count >= 5, 'Should have at least 5 entries');
        Assert.IsTrue(FieldMap.ContainsKey('Code'), 'Should contain Code key');
        FieldMap.Get('Code', MapValue);
        Assert.AreEqual('MAP001', MapValue, 'Code value should match');

        Assert.IsTrue(FieldMap.ContainsKey('Description'), 'Should contain Description key');
        FieldMap.Get('Description', MapValue);
        Assert.AreEqual('Map Test', MapValue, 'Description value should match');

        RecRef.Close();
    end;

    [Test]
    procedure TestBuildFieldMap_AmountField()
    var
        TestRecord: Record "CG Test Record";
        RecRef: RecordRef;
        FieldMap: Dictionary of [Text, Text];
        MapValue: Text;
    begin
        // [SCENARIO] BuildFieldMap includes decimal field values
        // [GIVEN] A record with amount
        TestRecord.Code := 'MAP002';
        TestRecord.Amount := 99.99;
        RecRef.GetTable(TestRecord);

        // [WHEN] Building field map
        FieldMap := FieldAccessor.BuildFieldMap(RecRef);

        // [THEN] Amount is in the map
        Assert.IsTrue(FieldMap.ContainsKey('Amount'), 'Should contain Amount key');
        FieldMap.Get('Amount', MapValue);
        Assert.IsTrue(MapValue.Contains('99.99'), 'Amount value should contain 99.99');

        RecRef.Close();
    end;
}
