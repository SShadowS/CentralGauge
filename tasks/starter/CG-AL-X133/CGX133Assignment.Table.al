table 70930 "CG X133 Assignment"
{
    DataClassification = CustomerContent;
    Caption = 'CG X133 Assignment';

    fields
    {
        field(1; "No."; Code[20])
        {
            Caption = 'No.';
            DataClassification = CustomerContent;
        }
        field(2; "Team Code"; Code[20])
        {
            Caption = 'Team Code';
            DataClassification = CustomerContent;
        }
        field(3; "Owner Code"; Code[20])
        {
            Caption = 'Owner Code';
            DataClassification = CustomerContent;
        }
        field(4; Priority; Integer)
        {
            Caption = 'Priority';
            DataClassification = CustomerContent;
        }
    }

    keys
    {
        key(PK; "No.")
        {
            Clustered = true;
        }
    }
}
