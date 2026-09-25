query 70500 "CGR Vehicle Status"
{
    QueryType = Normal;

    elements
    {
        dataitem(Vehicle; "CGR Vehicle")
        {
            column(VehicleNo; "No.") { }
            column(CheckedOut; "Checked Out") { }
            column(Mileage; Mileage) { }
        }
    }
}
