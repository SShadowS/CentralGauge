table 70430 "CG X078 Performance"
{
    Caption = 'CG X078 Performance';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer)
        {
            Caption = 'Entry No.';
        }
        field(2; "Agreement No."; Code[20])
        {
            Caption = 'Agreement No.';
        }
        field(3; "Play Name"; Text[50])
        {
            Caption = 'Play Name';
        }
        field(4; Category; Code[20])
        {
            Caption = 'Category';
        }
        field(5; Audience; Integer)
        {
            Caption = 'Audience';
        }
    }

    keys
    {
        key(PK; "Entry No.")
        {
            Clustered = true;
        }
    }
}
