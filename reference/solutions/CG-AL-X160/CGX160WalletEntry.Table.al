table 71441 "CG X160 Wallet Entry"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { DataClassification = CustomerContent; }
        field(2; "Wallet No."; Code[20]) { DataClassification = CustomerContent; }
        field(3; "Entry Type"; Enum "CG X160 Entry Type") { DataClassification = CustomerContent; }
        field(4; Amount; Decimal) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
        key(ByWallet; "Wallet No.", "Entry Type") { }
    }
}
