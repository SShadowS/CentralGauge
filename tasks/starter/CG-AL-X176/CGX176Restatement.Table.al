table 71590 "CG X176 Restatement"
{
    Caption = 'CG X176 Restatement';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Ledger Entry No."; Integer)
        {
            Caption = 'Ledger Entry No.';
        }
        field(2; "Item No."; Code[20])
        {
            Caption = 'Item No.';
        }
        field(3; "Prior Cost"; Decimal)
        {
            Caption = 'Prior Cost';
            DecimalPlaces = 2 : 2;
        }
        field(4; "Restated Cost"; Decimal)
        {
            Caption = 'Restated Cost';
            DecimalPlaces = 2 : 2;
        }
        field(5; "Cost Delta"; Decimal)
        {
            Caption = 'Cost Delta';
            DecimalPlaces = 2 : 2;
        }
        field(6; "Restate Counter"; Integer)
        {
            Caption = 'Restate Counter';
        }
    }

    keys
    {
        key(PK; "Ledger Entry No.")
        {
            Clustered = true;
        }
    }
}
