codeunit 80229 "CG-AL-H029 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        Detector: Codeunit "CG H029 Binary Detector";

    [Test]
    procedure TestIsBinaryField_Blob()
    begin
        Assert.IsTrue(Detector.IsBinaryField(69290, 20),
            'Image (Blob) is binary');
    end;

    [Test]
    procedure TestIsBinaryField_Media()
    begin
        Assert.IsTrue(Detector.IsBinaryField(69290, 30),
            'Photo (Media) is binary');
    end;

    [Test]
    procedure TestIsBinaryField_MediaSet()
    begin
        Assert.IsTrue(Detector.IsBinaryField(69290, 40),
            'Gallery (MediaSet) is binary');
    end;

    [Test]
    procedure TestIsBinaryField_Text()
    begin
        Assert.IsFalse(Detector.IsBinaryField(69290, 10),
            'Title (Text) is not binary');
    end;

    [Test]
    procedure TestIsBinaryField_Code()
    begin
        Assert.IsFalse(Detector.IsBinaryField(69290, 1),
            'Code is not binary');
    end;

    [Test]
    procedure TestIsBinaryField_Missing()
    begin
        Assert.IsFalse(Detector.IsBinaryField(69290, 9999),
            'Missing field is not binary');
    end;

    [Test]
    procedure TestIsBlobField_Blob()
    begin
        Assert.IsTrue(Detector.IsBlobField(69290, 20),
            'Image is Blob');
    end;

    [Test]
    procedure TestIsBlobField_Media()
    begin
        Assert.IsFalse(Detector.IsBlobField(69290, 30),
            'Media is not Blob');
    end;

    [Test]
    procedure TestIsBlobField_Text()
    begin
        Assert.IsFalse(Detector.IsBlobField(69290, 10),
            'Text is not Blob');
    end;

    [Test]
    procedure TestGetFieldTypeAsText_Code()
    begin
        Assert.AreEqual('Code', Detector.GetFieldTypeAsText(69290, 1),
            'Field 1 type is Code');
    end;

    [Test]
    procedure TestGetFieldTypeAsText_Blob()
    begin
        Assert.AreEqual('BLOB', Detector.GetFieldTypeAsText(69290, 20),
            'Field 20 type is BLOB');
    end;

    [Test]
    procedure TestGetFieldTypeAsText_Missing()
    begin
        Assert.AreEqual('', Detector.GetFieldTypeAsText(69290, 9999),
            'Missing field returns empty');
    end;

    [Test]
    procedure TestCountBinaryFields()
    begin
        Assert.AreEqual(3, Detector.CountBinaryFields(69290),
            'CG H029 Asset has 3 binary fields (Blob, Media, MediaSet)');
    end;

    [Test]
    procedure TestWriteBlobText_RejectsNonBlob()
    var
        Asset: Record "CG H029 Asset";
        RecRef: RecordRef;
    begin
        ResetAssets();
        Asset.Init();
        Asset.Code := 'NB1';
        Asset.Insert();
        RecRef.GetTable(Asset);
        Assert.IsFalse(Detector.WriteBlobText(RecRef, 10, 'data'),
            'Title is Text, not Blob - WriteBlobText must return false');
        RecRef.Close();
    end;

    [Test]
    procedure TestBlobRoundTrip_Content()
    var
        Asset: Record "CG H029 Asset";
        WriteRef: RecordRef;
        ReadRef: RecordRef;
    begin
        ResetAssets();
        Asset.Init();
        Asset.Code := 'BR1';
        Asset.Insert();
        WriteRef.GetTable(Asset);
        Assert.IsTrue(Detector.WriteBlobText(WriteRef, 20, 'hello blob world'),
            'WriteBlobText should succeed on Blob field');
        WriteRef.Close();

        Asset.Get('BR1');
        ReadRef.GetTable(Asset);
        Assert.AreEqual('hello blob world', Detector.ReadBlobText(ReadRef, 20),
            'Blob content should round-trip');
        ReadRef.Close();
    end;

    [Test]
    procedure TestBlobHasContent_AfterWrite()
    var
        Asset: Record "CG H029 Asset";
        WriteRef: RecordRef;
        ReadRef: RecordRef;
    begin
        ResetAssets();
        Asset.Init();
        Asset.Code := 'HC1';
        Asset.Insert();
        WriteRef.GetTable(Asset);
        Detector.WriteBlobText(WriteRef, 20, 'something');
        WriteRef.Close();

        Asset.Get('HC1');
        ReadRef.GetTable(Asset);
        Assert.IsTrue(Detector.BlobHasContent(ReadRef, 20),
            'Blob should have content after write');
        ReadRef.Close();
    end;

    [Test]
    procedure TestBlobHasContent_EmptyRecord()
    var
        Asset: Record "CG H029 Asset";
        ReadRef: RecordRef;
    begin
        ResetAssets();
        Asset.Init();
        Asset.Code := 'EM1';
        Asset.Insert();
        Asset.Get('EM1');
        ReadRef.GetTable(Asset);
        Assert.IsFalse(Detector.BlobHasContent(ReadRef, 20),
            'Blob should be empty when never written');
        ReadRef.Close();
    end;

    [Test]
    procedure TestReadBlobText_RejectsNonBlob()
    var
        Asset: Record "CG H029 Asset";
        RecRef: RecordRef;
    begin
        ResetAssets();
        Asset.Init();
        Asset.Code := 'NB2';
        Asset.Title := 'A title';
        Asset.Insert();
        RecRef.GetTable(Asset);
        Assert.AreEqual('', Detector.ReadBlobText(RecRef, 10),
            'Title is Text, not Blob - ReadBlobText must return empty');
        RecRef.Close();
    end;

    local procedure ResetAssets()
    var
        A: Record "CG H029 Asset";
    begin
        if not A.IsEmpty() then
            A.DeleteAll();
    end;
}
