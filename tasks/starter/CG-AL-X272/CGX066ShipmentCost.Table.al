table 70311 "CG X066 Shipment Cost"
{
    Caption = 'CG X066 Shipment Cost';
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
        field(3; "Posting Date"; Date)
        {
            Caption = 'Posting Date';
        }
        field(4; "Shipment Cost"; Decimal)
        {
            Caption = 'Shipment Cost';
            DecimalPlaces = 2 : 2;
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
