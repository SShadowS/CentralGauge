table 70960 "CG X136 Payment Terms"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Code"; Code[10]) { DataClassification = CustomerContent; }
        field(2; "Due Date Calculation"; DateFormula) { DataClassification = CustomerContent; }
        field(3; "Discount Date Calculation"; DateFormula) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "Code") { Clustered = true; }
    }
}
