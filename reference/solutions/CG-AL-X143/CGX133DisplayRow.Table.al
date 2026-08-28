table 70933 "CG X133 Display Row"
{
    DataClassification = CustomerContent;
    Caption = 'CG X133 Display Row';

    fields
    {
        field(1; "Assignment No."; Code[20])
        {
            Caption = 'Assignment No.';
            DataClassification = CustomerContent;
        }
        field(2; "Team Code"; Code[20])
        {
            Caption = 'Team Code';
            DataClassification = CustomerContent;
        }
        field(3; "Owner Display"; Text[100])
        {
            Caption = 'Owner Display';
            DataClassification = CustomerContent;
        }
        field(4; "Team Display"; Text[100])
        {
            Caption = 'Team Display';
            DataClassification = CustomerContent;
        }
        field(5; Priority; Integer)
        {
            Caption = 'Priority';
            DataClassification = CustomerContent;
        }
    }

    keys
    {
        key(PK; "Assignment No.")
        {
            Clustered = true;
        }
    }
}
