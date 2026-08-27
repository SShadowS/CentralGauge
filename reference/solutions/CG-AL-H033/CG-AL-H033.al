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

page 70033 "CG H033 Storage Setup"
{
    PageType = Card;
    SourceTable = "CG H033 Storage Setup";
    ApplicationArea = All;
    UsageCategory = Administration;
    Caption = 'CG H033 Storage Setup';
    InsertAllowed = false;
    DeleteAllowed = false;

    layout
    {
        area(Content)
        {
            group(General)
            {
                Caption = 'General';

                field("Storage Type"; Rec."Storage Type")
                {
                    ToolTip = 'Specifies the storage type used for archiving.';

                    trigger OnValidate()
                    begin
                        UpdateVisibility();
                    end;
                }
            }
            group(FileSystemSettings)
            {
                Caption = 'File System Settings';
                Visible = FileSystemVisible;

                field("File Archive Path"; Rec."File Archive Path")
                {
                    ToolTip = 'Specifies the path where files are archived.';
                }
                field("File Retention Days"; Rec."File Retention Days")
                {
                    ToolTip = 'Specifies the number of days files are retained.';
                }
            }
            group(AzureBlobSettings)
            {
                Caption = 'Azure Blob Settings';
                Visible = AzureBlobVisible;

                field("Azure Account"; Rec."Azure Account")
                {
                    ToolTip = 'Specifies the Azure storage account name.';
                }
                field("Azure Container"; Rec."Azure Container")
                {
                    ToolTip = 'Specifies the Azure blob container name.';
                }
                field("Azure Endpoint URL"; Rec."Azure Endpoint URL")
                {
                    ToolTip = 'Specifies the Azure endpoint URL.';
                }
            }
            group(AmazonS3Settings)
            {
                Caption = 'Amazon S3 Settings';
                Visible = AmazonS3Visible;

                field("S3 Bucket"; Rec."S3 Bucket")
                {
                    ToolTip = 'Specifies the Amazon S3 bucket name.';
                }
                field("S3 Region"; Rec."S3 Region")
                {
                    ToolTip = 'Specifies the Amazon S3 region.';
                }
                field("S3 Access Key Id"; Rec."S3 Access Key Id")
                {
                    ToolTip = 'Specifies the Amazon S3 access key id.';
                }
            }
            group(SFTPSettings)
            {
                Caption = 'SFTP Settings';
                Visible = SFTPVisible;

                field("SFTP Host"; Rec."SFTP Host")
                {
                    ToolTip = 'Specifies the SFTP host name.';
                }
                field("SFTP Port"; Rec."SFTP Port")
                {
                    ToolTip = 'Specifies the SFTP port number.';
                }
                field("SFTP Username"; Rec."SFTP Username")
                {
                    ToolTip = 'Specifies the SFTP user name.';
                }
            }
        }
    }

    trigger OnOpenPage()
    begin
        Rec.Reset();
        if not Rec.Get() then begin
            Rec.Init();
            Rec.Insert();
        end;
    end;

    trigger OnAfterGetRecord()
    begin
        UpdateVisibility();
    end;

    var
        FileSystemVisible: Boolean;
        AzureBlobVisible: Boolean;
        AmazonS3Visible: Boolean;
        SFTPVisible: Boolean;

    local procedure UpdateVisibility()
    begin
        FileSystemVisible := Rec."Storage Type" = Rec."Storage Type"::"File System";
        AzureBlobVisible := Rec."Storage Type" = Rec."Storage Type"::"Azure Blob";
        AmazonS3Visible := Rec."Storage Type" = Rec."Storage Type"::"Amazon S3";
        SFTPVisible := Rec."Storage Type" = Rec."Storage Type"::SFTP;
    end;
}