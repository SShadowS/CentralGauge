codeunit 80057 "CG-AL-E057 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        LibraryRandom: Codeunit "Library - Random";

    [Test]
    procedure TestTableExists()
    var
        Demo: Record "CG V16 Property Demo";
    begin
        Demo.Init();
    end;

    [Test]
    procedure TestPrimaryKeyAcceptsCode20()
    var
        Demo: Record "CG V16 Property Demo";
        TestCode: Code[20];
    begin
        TestCode := 'TEST-001';
        Demo."No." := TestCode;
        Assert.AreEqual(TestCode, Demo."No.", 'Primary key No. should accept Code[20]');
    end;

    [Test]
    procedure TestSensitiveTokenField()
    var
        Demo: Record "CG V16 Property Demo";
        TestText: Text[100];
    begin
        TestText := 'super-secret-token-value-XYZ';
        Demo."Sensitive Token" := TestText;
        Assert.AreEqual(TestText, Demo."Sensitive Token", 'Sensitive Token field should round-trip Text[100]');
    end;

    [Test]
    procedure TestAttachmentFieldExists()
    var
        Demo: Record "CG V16 Property Demo";
    begin
        Demo.Init();
        Demo."No." := 'ATT-001';
        Assert.IsFalse(Demo.Attachment.HasValue, 'Empty Attachment Media field should report no value');
    end;

    [Test]
    procedure TestCustLockedFieldStores()
    var
        Demo: Record "CG V16 Property Demo";
    begin
        Demo."Cust Locked" := 100;
        Assert.AreEqual(100, Demo."Cust Locked", 'Cust Locked field should store Integer values');
    end;

    [Test]
    procedure TestCustReadOnlyFieldStores()
    var
        Demo: Record "CG V16 Property Demo";
    begin
        Demo."Cust ReadOnly" := 200;
        Assert.AreEqual(200, Demo."Cust ReadOnly", 'Cust ReadOnly field should store Integer values');
    end;

    [Test]
    procedure TestCustEditableFieldStores()
    var
        Demo: Record "CG V16 Property Demo";
    begin
        Demo."Cust Editable" := 300;
        Assert.AreEqual(300, Demo."Cust Editable", 'Cust Editable field should store Integer values');
    end;

    [Test]
    procedure TestInsertAndGet()
    var
        Demo: Record "CG V16 Property Demo";
        TestCode: Code[20];
    begin
        TestCode := CopyStr(LibraryRandom.RandText(10), 1, 20);
        Demo.Init();
        Demo."No." := TestCode;
        Demo."Sensitive Token" := 'token-for-roundtrip';
        Demo."Cust Locked" := 1;
        Demo."Cust ReadOnly" := 2;
        Demo."Cust Editable" := 3;
        Demo.Insert(true);

        Clear(Demo);
        Assert.IsTrue(Demo.Get(TestCode), 'Inserted record should be retrievable by primary key');
        Assert.AreEqual('token-for-roundtrip', Demo."Sensitive Token", 'Sensitive Token survived insert/get');
        Assert.AreEqual(1, Demo."Cust Locked", 'Cust Locked survived insert/get');
        Assert.AreEqual(2, Demo."Cust ReadOnly", 'Cust ReadOnly survived insert/get');
        Assert.AreEqual(3, Demo."Cust Editable", 'Cust Editable survived insert/get');

        Demo.Delete();
    end;
}
