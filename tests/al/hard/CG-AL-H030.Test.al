codeunit 80230 "CG-AL-H030 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        Serializer: Codeunit "CG H030 PK Serializer";

    [Test]
    procedure TestCountKeyFields()
    begin
        Assert.AreEqual(3, Serializer.CountKeyFields(69300),
            'CG H030 Composite has 3 PK fields');
    end;

    [Test]
    procedure TestCountKeyFields_InvalidTable()
    begin
        Assert.AreEqual(0, Serializer.CountKeyFields(999999),
            'Invalid table returns 0');
    end;

    [Test]
    procedure TestSerializePrimaryKey()
    var
        Rec: Record "CG H030 Composite";
        RecRef: RecordRef;
    begin
        ResetRecords();
        Rec.Init();
        Rec."Region Code" := 'WEST';
        Rec."Customer No." := 'C00010';
        Rec."Line No." := 42;
        Rec.Insert();
        RecRef.GetTable(Rec);
        Assert.AreEqual('WEST|C00010|42', Serializer.SerializePrimaryKey(RecRef),
            'PK serialized as pipe-joined values');
        RecRef.Close();
    end;

    [Test]
    procedure TestGetByPrimaryKey_Found()
    var
        Rec: Record "CG H030 Composite";
        ResultRef: RecordRef;
        Found: Boolean;
    begin
        ResetRecords();
        Rec.Init();
        Rec."Region Code" := 'EAST';
        Rec."Customer No." := 'C00020';
        Rec."Line No." := 7;
        Rec.Description := 'Hello';
        Rec.Insert();

        Found := Serializer.GetByPrimaryKey(69300, 'EAST|C00020|7', ResultRef);

        Assert.IsTrue(Found, 'Record should be found');
        Assert.AreEqual('Hello', Format(ResultRef.Field(20).Value), 'Description should match');
        ResultRef.Close();
    end;

    [Test]
    procedure TestGetByPrimaryKey_NotFound()
    var
        ResultRef: RecordRef;
    begin
        ResetRecords();
        Assert.IsFalse(Serializer.GetByPrimaryKey(69300, 'NONE|MISSING|0', ResultRef),
            'Missing record returns false');
        ResultRef.Close();
    end;

    [Test]
    procedure TestGetByPrimaryKey_PieceCountMismatch()
    var
        ResultRef: RecordRef;
    begin
        Assert.IsFalse(Serializer.GetByPrimaryKey(69300, 'WEST|C00010', ResultRef),
            'Wrong piece count returns false');
    end;

    [Test]
    procedure TestRoundTrip()
    var
        Rec: Record "CG H030 Composite";
        SourceRef: RecordRef;
        ResultRef: RecordRef;
        KeyText: Text;
        Found: Boolean;
    begin
        ResetRecords();
        Rec.Init();
        Rec."Region Code" := 'NORTH';
        Rec."Customer No." := 'C00099';
        Rec."Line No." := 100;
        Rec.Insert();
        SourceRef.GetTable(Rec);

        KeyText := Serializer.SerializePrimaryKey(SourceRef);
        Found := Serializer.GetByPrimaryKey(69300, KeyText, ResultRef);

        Assert.IsTrue(Found, 'Round-trip should locate the record');
        Assert.AreEqual('NORTH', Format(ResultRef.Field(1).Value), 'Region preserved');
        Assert.AreEqual(100, ResultRef.Field(10).Value, 'Line No. preserved');
        SourceRef.Close();
        ResultRef.Close();
    end;

    [Test]
    procedure TestGetNthKeyFieldName_First()
    begin
        Assert.AreEqual('Region Code', Serializer.GetNthKeyFieldName(69300, 1, 1),
            'First PK field is Region Code');
    end;

    [Test]
    procedure TestGetNthKeyFieldName_Third()
    begin
        Assert.AreEqual('Line No.', Serializer.GetNthKeyFieldName(69300, 1, 3),
            'Third PK field is Line No.');
    end;

    [Test]
    procedure TestGetNthKeyFieldName_OutOfRange()
    begin
        Assert.AreEqual('', Serializer.GetNthKeyFieldName(69300, 1, 99),
            'Out-of-range FieldIdx returns empty');
    end;

    local procedure ResetRecords()
    var
        R: Record "CG H030 Composite";
    begin
        if not R.IsEmpty() then
            R.DeleteAll();
    end;
}
