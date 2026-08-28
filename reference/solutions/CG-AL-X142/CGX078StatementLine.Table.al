table 70431 "CG X078 Statement Line"
{
    Caption = 'CG X078 Statement Line';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Line No."; Integer)
        {
            Caption = 'Line No.';
        }
        field(2; "Play Name"; Text[50])
        {
            Caption = 'Play Name';
        }
        field(3; Category; Code[20])
        {
            Caption = 'Category';
        }
        field(4; Audience; Integer)
        {
            Caption = 'Audience';
        }
        field(5; Amount; Decimal)
        {
            Caption = 'Amount';
        }
        field(6; Credits; Integer)
        {
            Caption = 'Credits';
        }
    }

    keys
    {
        key(PK; "Line No.")
        {
            Clustered = true;
        }
    }
}
