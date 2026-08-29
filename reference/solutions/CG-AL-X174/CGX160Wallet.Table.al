table 71440 "CG X160 Wallet"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { DataClassification = CustomerContent; }
        field(2; Balance; Decimal) { DataClassification = CustomerContent; }
        field(3; "Total Charged"; Decimal) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "No.") { Clustered = true; }
    }
}
