table 70400 "CG X075 Contact"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { DataClassification = CustomerContent; }
        field(2; City; Text[30]) { DataClassification = CustomerContent; }
        field(3; "Credit Limit"; Decimal) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "No.") { Clustered = true; }
    }
}
