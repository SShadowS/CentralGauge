table 69290 "CG H029 Asset"
{
    Caption = 'CG H029 Asset';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Code"; Code[20])
        {
            Caption = 'Code';
            NotBlank = true;
        }
        field(10; "Title"; Text[100])
        {
            Caption = 'Title';
        }
        field(20; "Image"; Blob)
        {
            Caption = 'Image';
        }
        field(30; "Photo"; Media)
        {
            Caption = 'Photo';
        }
        field(40; "Gallery"; MediaSet)
        {
            Caption = 'Gallery';
        }
    }

    keys
    {
        key(PK; "Code")
        {
            Clustered = true;
        }
    }
}
