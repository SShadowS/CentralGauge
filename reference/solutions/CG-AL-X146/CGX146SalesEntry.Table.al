table 71301 "CG X146 Sales Entry"
{
    Caption = 'CG X146 Sales Entry';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer)
        {
            Caption = 'Entry No.';
        }
        field(2; "Salesperson Code"; Code[20])
        {
            Caption = 'Salesperson Code';
        }
        field(3; Amount; Decimal)
        {
            Caption = 'Amount';
            AutoFormatType = 1;
            DecimalPlaces = 2 : 2;
        }
        field(4; "Posting Date"; Date)
        {
            Caption = 'Posting Date';
        }
    }

    keys
    {
        key(PK; "Entry No.")
        {
            Clustered = true;
        }
        key(Salesperson; "Salesperson Code", "Entry No.")
        {
        }
    }
}
