codeunit 80033 "CG-AL-H033 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure TestFileSystemSection()
    var
        Setup: Record "CG H033 Storage Setup";
        Card: TestPage "CG H033 Storage Setup";
    begin
        Setup.DeleteAll();
        Setup.Init();
        Setup."Primary Key" := '';
        Setup."Storage Type" := Setup."Storage Type"::"File System";
        Setup.Insert();

        Card.OpenEdit();

        // File System fields visible
        Assert.IsTrue(Card."File Archive Path".Visible(),
            'File Archive Path must be visible when Storage Type = File System');
        Assert.IsTrue(Card."File Retention Days".Visible(),
            'File Retention Days must be visible when Storage Type = File System');

        // Azure Blob hidden
        Assert.IsFalse(Card."Azure Account".Visible(),
            'Azure Account must be hidden when Storage Type = File System');
        Assert.IsFalse(Card."Azure Container".Visible(),
            'Azure Container must be hidden when Storage Type = File System');
        Assert.IsFalse(Card."Azure Endpoint URL".Visible(),
            'Azure Endpoint URL must be hidden when Storage Type = File System');

        // S3 hidden
        Assert.IsFalse(Card."S3 Bucket".Visible(),
            'S3 Bucket must be hidden when Storage Type = File System');
        Assert.IsFalse(Card."S3 Region".Visible(),
            'S3 Region must be hidden when Storage Type = File System');
        Assert.IsFalse(Card."S3 Access Key Id".Visible(),
            'S3 Access Key Id must be hidden when Storage Type = File System');

        // SFTP hidden
        Assert.IsFalse(Card."SFTP Host".Visible(),
            'SFTP Host must be hidden when Storage Type = File System');
        Assert.IsFalse(Card."SFTP Port".Visible(),
            'SFTP Port must be hidden when Storage Type = File System');
        Assert.IsFalse(Card."SFTP Username".Visible(),
            'SFTP Username must be hidden when Storage Type = File System');

        Card.Close();
    end;

    [Test]
    procedure TestAzureBlobSection()
    var
        Setup: Record "CG H033 Storage Setup";
        Card: TestPage "CG H033 Storage Setup";
    begin
        Setup.DeleteAll();
        Setup.Init();
        Setup."Primary Key" := '';
        Setup."Storage Type" := Setup."Storage Type"::"Azure Blob";
        Setup.Insert();

        Card.OpenEdit();

        // Azure Blob visible
        Assert.IsTrue(Card."Azure Account".Visible(),
            'Azure Account must be visible when Storage Type = Azure Blob');
        Assert.IsTrue(Card."Azure Container".Visible(),
            'Azure Container must be visible when Storage Type = Azure Blob');
        Assert.IsTrue(Card."Azure Endpoint URL".Visible(),
            'Azure Endpoint URL must be visible when Storage Type = Azure Blob');

        // File System hidden
        Assert.IsFalse(Card."File Archive Path".Visible(),
            'File Archive Path must be hidden when Storage Type = Azure Blob');
        Assert.IsFalse(Card."File Retention Days".Visible(),
            'File Retention Days must be hidden when Storage Type = Azure Blob');

        // S3 hidden
        Assert.IsFalse(Card."S3 Bucket".Visible(),
            'S3 Bucket must be hidden when Storage Type = Azure Blob');
        Assert.IsFalse(Card."S3 Region".Visible(),
            'S3 Region must be hidden when Storage Type = Azure Blob');
        Assert.IsFalse(Card."S3 Access Key Id".Visible(),
            'S3 Access Key Id must be hidden when Storage Type = Azure Blob');

        // SFTP hidden
        Assert.IsFalse(Card."SFTP Host".Visible(),
            'SFTP Host must be hidden when Storage Type = Azure Blob');
        Assert.IsFalse(Card."SFTP Port".Visible(),
            'SFTP Port must be hidden when Storage Type = Azure Blob');
        Assert.IsFalse(Card."SFTP Username".Visible(),
            'SFTP Username must be hidden when Storage Type = Azure Blob');

        Card.Close();
    end;

    [Test]
    procedure TestAmazonS3Section()
    var
        Setup: Record "CG H033 Storage Setup";
        Card: TestPage "CG H033 Storage Setup";
    begin
        Setup.DeleteAll();
        Setup.Init();
        Setup."Primary Key" := '';
        Setup."Storage Type" := Setup."Storage Type"::"Amazon S3";
        Setup.Insert();

        Card.OpenEdit();

        // S3 visible
        Assert.IsTrue(Card."S3 Bucket".Visible(),
            'S3 Bucket must be visible when Storage Type = Amazon S3');
        Assert.IsTrue(Card."S3 Region".Visible(),
            'S3 Region must be visible when Storage Type = Amazon S3');
        Assert.IsTrue(Card."S3 Access Key Id".Visible(),
            'S3 Access Key Id must be visible when Storage Type = Amazon S3');

        // File System hidden
        Assert.IsFalse(Card."File Archive Path".Visible(),
            'File Archive Path must be hidden when Storage Type = Amazon S3');
        Assert.IsFalse(Card."File Retention Days".Visible(),
            'File Retention Days must be hidden when Storage Type = Amazon S3');

        // Azure Blob hidden
        Assert.IsFalse(Card."Azure Account".Visible(),
            'Azure Account must be hidden when Storage Type = Amazon S3');
        Assert.IsFalse(Card."Azure Container".Visible(),
            'Azure Container must be hidden when Storage Type = Amazon S3');
        Assert.IsFalse(Card."Azure Endpoint URL".Visible(),
            'Azure Endpoint URL must be hidden when Storage Type = Amazon S3');

        // SFTP hidden
        Assert.IsFalse(Card."SFTP Host".Visible(),
            'SFTP Host must be hidden when Storage Type = Amazon S3');
        Assert.IsFalse(Card."SFTP Port".Visible(),
            'SFTP Port must be hidden when Storage Type = Amazon S3');
        Assert.IsFalse(Card."SFTP Username".Visible(),
            'SFTP Username must be hidden when Storage Type = Amazon S3');

        Card.Close();
    end;

    [Test]
    procedure TestSftpSection()
    var
        Setup: Record "CG H033 Storage Setup";
        Card: TestPage "CG H033 Storage Setup";
    begin
        Setup.DeleteAll();
        Setup.Init();
        Setup."Primary Key" := '';
        Setup."Storage Type" := Setup."Storage Type"::SFTP;
        Setup.Insert();

        Card.OpenEdit();

        // SFTP visible
        Assert.IsTrue(Card."SFTP Host".Visible(),
            'SFTP Host must be visible when Storage Type = SFTP');
        Assert.IsTrue(Card."SFTP Port".Visible(),
            'SFTP Port must be visible when Storage Type = SFTP');
        Assert.IsTrue(Card."SFTP Username".Visible(),
            'SFTP Username must be visible when Storage Type = SFTP');

        // File System hidden
        Assert.IsFalse(Card."File Archive Path".Visible(),
            'File Archive Path must be hidden when Storage Type = SFTP');
        Assert.IsFalse(Card."File Retention Days".Visible(),
            'File Retention Days must be hidden when Storage Type = SFTP');

        // Azure Blob hidden
        Assert.IsFalse(Card."Azure Account".Visible(),
            'Azure Account must be hidden when Storage Type = SFTP');
        Assert.IsFalse(Card."Azure Container".Visible(),
            'Azure Container must be hidden when Storage Type = SFTP');
        Assert.IsFalse(Card."Azure Endpoint URL".Visible(),
            'Azure Endpoint URL must be hidden when Storage Type = SFTP');

        // S3 hidden
        Assert.IsFalse(Card."S3 Bucket".Visible(),
            'S3 Bucket must be hidden when Storage Type = SFTP');
        Assert.IsFalse(Card."S3 Region".Visible(),
            'S3 Region must be hidden when Storage Type = SFTP');
        Assert.IsFalse(Card."S3 Access Key Id".Visible(),
            'S3 Access Key Id must be hidden when Storage Type = SFTP');

        Card.Close();
    end;

    [Test]
    procedure TestDatabaseHidesAllSections()
    var
        Setup: Record "CG H033 Storage Setup";
        Card: TestPage "CG H033 Storage Setup";
    begin
        Setup.DeleteAll();
        Setup.Init();
        Setup."Primary Key" := '';
        Setup."Storage Type" := Setup."Storage Type"::Database;
        Setup.Insert();

        Card.OpenEdit();

        Assert.IsFalse(Card."File Archive Path".Visible(),
            'File Archive Path must be hidden when Storage Type = Database');
        Assert.IsFalse(Card."File Retention Days".Visible(),
            'File Retention Days must be hidden when Storage Type = Database');
        Assert.IsFalse(Card."Azure Account".Visible(),
            'Azure Account must be hidden when Storage Type = Database');
        Assert.IsFalse(Card."Azure Container".Visible(),
            'Azure Container must be hidden when Storage Type = Database');
        Assert.IsFalse(Card."Azure Endpoint URL".Visible(),
            'Azure Endpoint URL must be hidden when Storage Type = Database');
        Assert.IsFalse(Card."S3 Bucket".Visible(),
            'S3 Bucket must be hidden when Storage Type = Database');
        Assert.IsFalse(Card."S3 Region".Visible(),
            'S3 Region must be hidden when Storage Type = Database');
        Assert.IsFalse(Card."S3 Access Key Id".Visible(),
            'S3 Access Key Id must be hidden when Storage Type = Database');
        Assert.IsFalse(Card."SFTP Host".Visible(),
            'SFTP Host must be hidden when Storage Type = Database');
        Assert.IsFalse(Card."SFTP Port".Visible(),
            'SFTP Port must be hidden when Storage Type = Database');
        Assert.IsFalse(Card."SFTP Username".Visible(),
            'SFTP Username must be hidden when Storage Type = Database');

        Card.Close();
    end;
}
