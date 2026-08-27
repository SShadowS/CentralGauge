table 70033 "CG H033 Storage Setup"
{
    Caption = 'CG H033 Storage Setup';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Primary Key"; Code[10])
        {
            Caption = 'Primary Key';
        }
        field(10; "Storage Type"; Option)
        {
            Caption = 'Storage Type';
            OptionMembers = Database,"File System","Azure Blob","Amazon S3",SFTP;
            OptionCaption = 'Database,File System,Azure Blob,Amazon S3,SFTP';
        }
        field(20; "File Archive Path"; Text[250])
        {
            Caption = 'File Archive Path';
        }
        field(21; "File Retention Days"; Integer)
        {
            Caption = 'File Retention Days';
        }
        field(30; "Azure Account"; Text[100])
        {
            Caption = 'Azure Account';
        }
        field(31; "Azure Container"; Text[100])
        {
            Caption = 'Azure Container';
        }
        field(32; "Azure Endpoint URL"; Text[250])
        {
            Caption = 'Azure Endpoint URL';
        }
        field(40; "S3 Bucket"; Text[100])
        {
            Caption = 'S3 Bucket';
        }
        field(41; "S3 Region"; Text[50])
        {
            Caption = 'S3 Region';
        }
        field(42; "S3 Access Key Id"; Text[100])
        {
            Caption = 'S3 Access Key Id';
        }
        field(50; "SFTP Host"; Text[250])
        {
            Caption = 'SFTP Host';
        }
        field(51; "SFTP Port"; Integer)
        {
            Caption = 'SFTP Port';
        }
        field(52; "SFTP Username"; Text[100])
        {
            Caption = 'SFTP Username';
        }
    }

    keys
    {
        key(PK; "Primary Key")
        {
            Clustered = true;
        }
    }
}
