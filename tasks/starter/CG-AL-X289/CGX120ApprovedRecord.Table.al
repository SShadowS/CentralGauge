table 70800 "CG X120 Approved Record"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { DataClassification = CustomerContent; }
        field(2; "Contact Name"; Text[50]) { DataClassification = CustomerContent; }
        field(3; "Credit Limit"; Decimal) { DataClassification = CustomerContent; }
        field(4; "Approved Contact Name"; Text[50]) { DataClassification = CustomerContent; }
        field(5; "Approved Credit Limit"; Decimal) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "No.") { Clustered = true; }
    }
}
