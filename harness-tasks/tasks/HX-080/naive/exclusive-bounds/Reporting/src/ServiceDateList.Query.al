query 70520 "CGR Service Date List"
{
    QueryType = Normal;

    elements
    {
        dataitem(Vehicle; "CGR Vehicle")
        {
            column(VehicleNo; "No.") { }
            column(ServicePlanCode; "Service Plan Code") { }
            column(LastServiceDate; "Last Service Date") { }
            filter(ServiceDateFilter; "Last Service Date") { }
        }
    }
}
