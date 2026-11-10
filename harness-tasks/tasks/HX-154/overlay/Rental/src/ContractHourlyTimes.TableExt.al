tableextension 70290 "CGR Contract Hourly Times" extends "CGR Rental Contract"
{
    fields
    {
        field(70290; "Picked Up At"; DateTime) { DataClassification = CustomerContent; }
        field(70291; "Returned At"; DateTime) { DataClassification = CustomerContent; }
    }
}
