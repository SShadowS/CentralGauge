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
